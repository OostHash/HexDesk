use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tracing::debug;

use crate::app_state::AppState;

/// Minimal HTTP/1.1 file server for the local image cache: GET /{filename}
/// from `cache_dir`, with keep-alive so one browser connection serves many
/// images.
///
/// It reads each request up to the blank line after the headers. Reading only
/// a fixed number of bytes and closing the socket after one response does not
/// work: Chromium's image requests are often longer, and closing a
/// socket with unread data makes Windows send a reset (ERR_CONNECTION_RESET).
pub(crate) async fn serve_image_files(listener: tokio::net::TcpListener, cache_dir: PathBuf) {
    let cache_dir = Arc::new(cache_dir);
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let dir = Arc::clone(&cache_dir);
        tokio::spawn(serve_connection(stream, dir));
    }
}

/// Longest request head we accept; image requests are well under 2 KB.
const MAX_HEAD: usize = 16 * 1024;
/// A browser keeps idle connections around; close ours after this long.
const IDLE: std::time::Duration = std::time::Duration::from_secs(15);

/// Serves requests on one connection until the client closes it, asks to
/// close, goes idle, or sends something we cannot parse.
async fn serve_connection(mut stream: tokio::net::TcpStream, dir: Arc<PathBuf>) {
    use tokio::io::AsyncWriteExt;
    let mut pending: Vec<u8> = Vec::with_capacity(2048);
    loop {
        let head = match tokio::time::timeout(IDLE, read_head(&mut stream, &mut pending)).await {
            Ok(Ok(Some(head))) => head,
            Ok(Ok(None)) | Ok(Err(_)) | Err(_) => break,
        };
        let request = parse_head(&head);
        let keep_alive = request.as_ref().is_some_and(|r| r.keep_alive);
        let (status, mime, body) = match request.and_then(|r| r.filename) {
            Some(name) => match tokio::fs::read(dir.join(&name)).await {
                Ok(data) => ("200 OK", mime_for(&name), data),
                Err(_) => ("404 Not Found", "text/plain", Vec::new()),
            },
            None => ("400 Bad Request", "text/plain", Vec::new()),
        };
        // Access-Control-Allow-Origin lets the app read the pixels of these
        // images in a canvas (the icon check); without it the canvas is tainted.
        let header = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: public, max-age=86400\r\nAccess-Control-Allow-Origin: *\r\nConnection: {}\r\n\r\n",
            body.len(),
            if keep_alive { "keep-alive" } else { "close" },
        );
        if stream.write_all(header.as_bytes()).await.is_err()
            || stream.write_all(&body).await.is_err()
        {
            return;
        }
        if !keep_alive {
            break;
        }
    }
    // A graceful close (FIN) instead of a reset.
    let _ = stream.shutdown().await;
}

/// Reads until a full request head ("\r\n\r\n") is buffered and returns it;
/// bytes after it stay in `pending` for the next request. None on a clean
/// close before any bytes; an error on a too-long head or a broken socket.
async fn read_head<R: tokio::io::AsyncRead + Unpin>(
    stream: &mut R,
    pending: &mut Vec<u8>,
) -> std::io::Result<Option<Vec<u8>>> {
    use tokio::io::AsyncReadExt;
    let mut chunk = [0u8; 2048];
    loop {
        if let Some(end) = pending.windows(4).position(|w| w == b"\r\n\r\n") {
            let rest = pending.split_off(end + 4);
            let head = std::mem::replace(pending, rest);
            return Ok(Some(head));
        }
        if pending.len() > MAX_HEAD {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request head too long",
            ));
        }
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return if pending.is_empty() {
                Ok(None)
            } else {
                Err(std::io::ErrorKind::UnexpectedEof.into())
            };
        }
        pending.extend_from_slice(&chunk[..n]);
    }
}

struct ImageRequest {
    /// The requested file, or None when the path is not a plain file name.
    filename: Option<String>,
    keep_alive: bool,
}

/// Parses "GET /name HTTP/1.x" plus a Connection header. HTTP/1.1 keeps the
/// connection open unless it says close; HTTP/1.0 only with keep-alive.
fn parse_head(head: &[u8]) -> Option<ImageRequest> {
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let mut parts = lines.next()?.split_whitespace();
    let (method, path, version) = (parts.next()?, parts.next()?, parts.next()?);
    let connection = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("connection"))
        .map(|(_, v)| v.trim().to_ascii_lowercase());
    let keep_alive = match connection.as_deref() {
        Some(v) if v.contains("close") => false,
        Some(v) if v.contains("keep-alive") => true,
        _ => version == "HTTP/1.1",
    };
    let name = path.strip_prefix('/').unwrap_or("");
    let safe = method == "GET"
        && !name.is_empty()
        && !name.contains("..")
        && !name.contains('/')
        && !name.contains('\\');
    Some(ImageRequest {
        filename: safe.then(|| name.to_string()),
        keep_alive,
    })
}

fn mime_for(name: &str) -> &'static str {
    if name.ends_with(".png") {
        "image/png"
    } else if name.ends_with(".jpg") || name.ends_with(".jpeg") {
        "image/jpeg"
    } else if name.ends_with(".webp") {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

/// Returns the base URL of the local image server, e.g. "http://127.0.0.1:51234".
/// Frontend uses this as `${baseUrl}/${imageName}` to load cached images from disk.
#[tauri::command]
pub(crate) fn get_img_cache_dir(state: State<AppState>) -> String {
    let port = *state.img_server_port.lock().unwrap();
    format!("http://127.0.0.1:{}", port)
}

/// Download images for all craftable items that aren't already cached to disk.
/// Returns immediately — downloads happen on background threads (8 in parallel).
/// Safe to call every startup; already-cached files are skipped via existence check.
#[tauri::command]
pub(crate) async fn prewarm_image_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::collections::HashSet;
    use std::sync::Arc;
    let items: Vec<_> = state
        .wfcd_items
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let cache_dir = Arc::new(state.img_cache_dir.clone());

    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let names: Vec<String> = items
            .iter()
            .filter_map(|i| i.image_name.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .filter(|n| !cache_dir.join(n).exists())
            .collect();

        if names.is_empty() {
            return;
        }
        debug!(count = names.len(), "prewarming images in background");

        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(10))
            .build();

        for chunk in names.chunks(8) {
            let handles: Vec<_> = chunk
                .iter()
                .map(|name| {
                    let dir = Arc::clone(&cache_dir);
                    let name = name.clone();
                    let agent = agent.clone();
                    std::thread::spawn(move || {
                        let url = format!("https://cdn.warframestat.us/img/{}", name);
                        if let Ok(resp) = agent.get(&url).call() {
                            let mut buf = Vec::new();
                            // Limit to 5 MB to prevent memory exhaustion from malformed responses
                            if resp
                                .into_reader()
                                .take(5 * 1024 * 1024)
                                .read_to_end(&mut buf)
                                .is_ok()
                            {
                                let _ = std::fs::write(dir.join(&name), buf);
                            }
                        }
                    })
                })
                .collect();
            for h in handles {
                let _ = h.join();
            }
        }
        debug!("prewarm complete");
    }); // intentionally not awaited — fire and forget

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    /// A request head the size Chromium sends for an image (well over 512 bytes).
    fn browser_request(name: &str, connection: &str) -> String {
        let filler = "x".repeat(600);
        format!(
            "GET /{name} HTTP/1.1\r\nHost: 127.0.0.1\r\nUser-Agent: Mozilla/5.0 {filler}\r\nAccept: image/avif,image/webp,*/*\r\nConnection: {connection}\r\n\r\n"
        )
    }

    /// Reads one response: the head, then exactly Content-Length body bytes.
    async fn read_response(stream: &mut tokio::net::TcpStream) -> (String, Vec<u8>) {
        let mut pending = Vec::new();
        let head = read_head(stream, &mut pending).await.unwrap().unwrap();
        let head = String::from_utf8(head).unwrap();
        let len: usize = head
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: "))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        while pending.len() < len {
            let mut chunk = [0u8; 4096];
            let n = stream.read(&mut chunk).await.unwrap();
            assert!(n > 0, "connection closed mid-body");
            pending.extend_from_slice(&chunk[..n]);
        }
        (head, pending)
    }

    async fn start_server(dir: &std::path::Path) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(serve_image_files(listener, dir.to_path_buf()));
        addr
    }

    fn temp_dir_with(files: &[(&str, &[u8])]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ff-img-test-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        for (name, data) in files {
            std::fs::write(dir.join(name), data).unwrap();
        }
        dir
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn serves_several_long_requests_on_one_connection() {
        let dir = temp_dir_with(&[("a.png", b"AAAA"), ("b.webp", b"BBBBBB")]);
        runtime().block_on(async {
            let addr = start_server(&dir).await;
            let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
            for (name, body, mime) in [
                ("a.png", &b"AAAA"[..], "image/png"),
                ("b.webp", &b"BBBBBB"[..], "image/webp"),
                ("a.png", &b"AAAA"[..], "image/png"),
            ] {
                stream
                    .write_all(browser_request(name, "keep-alive").as_bytes())
                    .await
                    .unwrap();
                let (head, got) = read_response(&mut stream).await;
                assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
                assert!(head.contains(&format!("Content-Type: {mime}")), "{head}");
                assert!(head.contains("Connection: keep-alive"), "{head}");
                // The icon check reads pixels of these images in a canvas.
                assert!(head.contains("Access-Control-Allow-Origin: *"), "{head}");
                assert_eq!(got, body);
            }
        });
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn answers_pipelined_requests_in_order() {
        let dir = temp_dir_with(&[("a.png", b"A"), ("b.png", b"BB")]);
        runtime().block_on(async {
            let addr = start_server(&dir).await;
            let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
            let both = format!(
                "{}{}",
                browser_request("a.png", "keep-alive"),
                browser_request("b.png", "keep-alive")
            );
            stream.write_all(both.as_bytes()).await.unwrap();
            assert_eq!(read_response(&mut stream).await.1, b"A");
            assert_eq!(read_response(&mut stream).await.1, b"BB");
        });
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn closes_cleanly_when_asked_and_reports_missing_files() {
        let dir = temp_dir_with(&[]);
        runtime().block_on(async {
            let addr = start_server(&dir).await;
            let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
            stream
                .write_all(browser_request("missing.png", "close").as_bytes())
                .await
                .unwrap();
            let (head, body) = read_response(&mut stream).await;
            assert!(head.starts_with("HTTP/1.1 404 Not Found"), "{head}");
            assert!(head.contains("Connection: close"), "{head}");
            assert!(body.is_empty());
            // A graceful close: the next read sees end of stream, not a reset.
            let mut rest = [0u8; 16];
            assert_eq!(stream.read(&mut rest).await.unwrap(), 0);
        });
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn parses_requests_and_refuses_paths() {
        let ok = parse_head(b"GET /a.png HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        assert_eq!(ok.filename.as_deref(), Some("a.png"));
        assert!(ok.keep_alive);
        assert!(
            !parse_head(b"GET /a.png HTTP/1.0\r\n\r\n")
                .unwrap()
                .keep_alive
        );
        assert!(
            parse_head(b"GET /a.png HTTP/1.0\r\nconnection: Keep-Alive\r\n\r\n")
                .unwrap()
                .keep_alive
        );
        assert!(
            !parse_head(b"GET /a.png HTTP/1.1\r\nConnection: close\r\n\r\n")
                .unwrap()
                .keep_alive
        );
        for bad in [
            &b"GET /../secret HTTP/1.1\r\n\r\n"[..],
            b"GET /dir/a.png HTTP/1.1\r\n\r\n",
            b"GET /a\\b HTTP/1.1\r\n\r\n",
            b"POST /a.png HTTP/1.1\r\n\r\n",
            b"GET / HTTP/1.1\r\n\r\n",
        ] {
            assert!(
                parse_head(bad).unwrap().filename.is_none(),
                "{:?}",
                std::str::from_utf8(bad)
            );
        }
        assert!(parse_head(b"nonsense").is_none());
    }
}
