//! Capturing the game window on Windows.
//!
//! PrintWindow (GDI) is fast and reads the game window itself, in windowed
//! and borderless windowed play. In fullscreen exclusive play GDI cannot
//! reach the picture and returns a black frame; DXGI Desktop Duplication then
//! reads the monitor the game is on.

use crate::frame::Frame;
use windows_sys::Win32::Foundation::HWND;

/// Below this average brightness a frame is black. The darkest game screens
/// average about 40.
const BLACK: u32 = 20;

/// How the game was captured.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    PrintWindow,
    Dxgi,
}

impl Method {
    pub const fn name(self) -> &'static str {
        match self {
            Method::PrintWindow => "PrintWindow",
            Method::Dxgi => "DXGI",
        }
    }
}

/// A capture of the game window.
#[derive(Debug, Clone)]
pub struct Capture {
    pub frame: Frame,
    pub method: Method,
    /// Average brightness of the frame (0 to 255).
    pub brightness: u32,
    /// Brightness of the PrintWindow frame when DXGI replaced it.
    pub print_window_brightness: Option<u32>,
}

/// The centre of the game window in desktop coordinates.
fn game_window_center() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};
    let title: Vec<u16> = "Warframe\0".encode_utf16().collect();
    unsafe {
        let hwnd = FindWindowW(std::ptr::null(), title.as_ptr());
        if hwnd.is_null() {
            return None;
        }
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        Some(((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2))
    }
}

/// Captures one window's client area without anything behind or beside it.
/// Used for a HexDesk overlay after its WebView has confirmed that it drew.
pub fn capture_window(hwnd: isize) -> Result<Frame, String> {
    if hwnd == 0 {
        return Err("Window not found".to_string());
    }
    // Callers pass the handle as an integer; windows-sys models it as a pointer.
    print_window(hwnd as HWND)
}

/// How long a DXGI capture waits for the GPU to finish copying the frame.
const MAP_LIMIT: std::time::Duration = std::time::Duration::from_millis(1000);

/// One DXGI duplication at a time: a second one of the same monitor fails,
/// and a loop over every monitor would then take another one.
static DXGI: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Captures the game window. Fails when the game window is not found.
pub fn capture_game() -> Result<Capture, String> {
    let hwnd = game_window().ok_or("Warframe window not found")?;
    let frame = print_window(hwnd)?;
    let brightness = frame.brightness();
    if brightness >= BLACK {
        return Ok(Capture {
            frame,
            method: Method::PrintWindow,
            brightness,
            print_window_brightness: None,
        });
    }
    // DXGI only wins when it is at least as bright: it returns a black frame
    // too when the monitor had no new picture.
    if let Some(dxgi) = game_window_center().and_then(dxgi) {
        let dxgi_brightness = dxgi.brightness();
        if dxgi_brightness >= brightness {
            return Ok(Capture {
                frame: dxgi,
                method: Method::Dxgi,
                brightness: dxgi_brightness,
                print_window_brightness: Some(brightness),
            });
        }
    }
    Ok(Capture {
        frame,
        method: Method::PrintWindow,
        brightness,
        print_window_brightness: None,
    })
}

/// Finds the Warframe window by its title.
fn game_window() -> Option<HWND> {
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

    let title: Vec<u16> = "Warframe\0".encode_utf16().collect();
    let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    (!hwnd.is_null()).then_some(hwnd)
}

/// Captures a window's client area through GDI PrintWindow, which works for
/// windowed and borderless windowed content.
fn print_window(hwnd: HWND) -> Result<Frame, String> {
    use std::mem;
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
            ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
            RGBQUAD,
        },
        UI::WindowsAndMessaging::GetClientRect,
    };
    #[link(name = "user32")]
    extern "system" {
        fn PrintWindow(hwnd: HWND, hdcblt: HDC, nflags: u32) -> i32;
    }
    const PW_RENDERFULLCONTENT: u32 = 2;

    unsafe {
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(hwnd, &mut rect) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let full_w = (rect.right - rect.left) as u32;
        let full_h = (rect.bottom - rect.top) as u32;
        if full_w < 100 || full_h < 100 {
            return Err("Window too small".into());
        }

        let hdc_win = GetDC(hwnd);
        let hdc_mem = CreateCompatibleDC(hdc_win);
        let hbm = CreateCompatibleBitmap(hdc_win, full_w as i32, full_h as i32);
        let hbm_old = SelectObject(hdc_mem, hbm);
        if PrintWindow(hwnd, hdc_mem, PW_RENDERFULLCONTENT) == 0 {
            SelectObject(hdc_mem, hbm_old);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_win);
            return Err(std::io::Error::last_os_error().to_string());
        }

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: full_w as i32,
                biHeight: -(full_h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };
        let mut pixels = vec![0u8; (full_w * full_h * 4) as usize];
        GetDIBits(
            hdc_mem,
            hbm,
            0,
            full_h,
            pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );
        SelectObject(hdc_mem, hbm_old);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(hwnd, hdc_win);
        Ok(Frame::new(pixels, full_w, full_h))
    }
}

/// DXGI Desktop Duplication capture of the monitor that holds the desktop
/// point `at`, which works in fullscreen exclusive mode too.
fn dxgi(at: (i32, i32)) -> Option<Frame> {
    let waited = std::time::Instant::now();
    let _one_at_a_time = DXGI.lock().unwrap_or_else(|e| e.into_inner());
    let started = std::time::Instant::now();
    // How long each step took, for the debug log: a capture that is slow
    // shows here where the time went.
    let mut steps: Vec<(&str, u128)> = vec![("wait", started.duration_since(waited).as_millis())];
    let mut mark = std::time::Instant::now();
    let mut step = |name: &'static str, steps: &mut Vec<(&str, u128)>| {
        steps.push((name, mark.elapsed().as_millis()));
        mark = std::time::Instant::now();
    };
    use windows::core::Interface; // required for .cast() on COM types
    use windows::Win32::Graphics::{
        Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
        Direct3D11::{
            D3D11CreateDevice, ID3D11Resource, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
            D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_FLAG_DO_NOT_WAIT, D3D11_MAP_READ,
            D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
        },
        Dxgi::Common::DXGI_SAMPLE_DESC,
        Dxgi::{
            CreateDXGIFactory1, IDXGIAdapter, IDXGIFactory1, IDXGIOutput, IDXGIOutput1,
            IDXGIResource, DXGI_ERROR_WAS_STILL_DRAWING, DXGI_OUTDUPL_FRAME_INFO,
        },
    };

    // Walk every adapter → every output. We create a D3D device bound to each
    // specific adapter before calling DuplicateOutput — cross-adapter calls fail
    // on multi-GPU systems (e.g. Intel iGPU + NVIDIA dGPU) where the game runs
    // on the discrete GPU. A single device created with D3D_DRIVER_TYPE_HARDWARE
    // defaults to adapter 0 (often the iGPU), causing DuplicateOutput to succeed
    // only on the iGPU's outputs and silently miss the game on the dGPU.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;

        let mut result: Option<Frame> = None;

        'outer: for ai in 0u32.. {
            let adapter = match factory.EnumAdapters(ai) {
                Ok(a) => a,
                Err(_) => break,
            };

            // Create a D3D device bound to THIS adapter so DuplicateOutput is same-adapter.
            let adapter_iface: IDXGIAdapter = match adapter.cast() {
                Ok(a) => a,
                Err(_) => continue,
            };
            let mut device = None;
            let mut ctx = None;
            step("enumerate", &mut steps);
            if D3D11CreateDevice(
                Some(&adapter_iface),
                D3D_DRIVER_TYPE_UNKNOWN,
                windows::Win32::Foundation::HMODULE::default(),
                Default::default(),
                None,
                7,
                Some(&mut device),
                None,
                Some(&mut ctx),
            )
            .is_err()
            {
                continue;
            }
            let device = match device {
                Some(d) => d,
                None => continue,
            };
            let ctx = match ctx {
                Some(c) => c,
                None => continue,
            };
            let unk: windows::core::IUnknown = match device.cast() {
                Ok(u) => u,
                Err(_) => continue,
            };

            for oi in 0u32.. {
                let output: IDXGIOutput = match adapter.EnumOutputs(oi) {
                    Ok(o) => o,
                    Err(_) => break,
                };
                let Ok(desc) = output.GetDesc() else {
                    continue;
                };
                let r = desc.DesktopCoordinates;
                let holds = (r.left..r.right).contains(&at.0) && (r.top..r.bottom).contains(&at.1);
                if !holds {
                    continue;
                }
                let out1: IDXGIOutput1 = match output.cast() {
                    Ok(o) => o,
                    Err(_) => continue,
                };

                step("device", &mut steps);
                let dupl = match out1.DuplicateOutput(&unk) {
                    Ok(d) => d,
                    Err(_) => continue,
                };

                // Acquire current frame (500 ms timeout)
                let mut fi = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut res: Option<IDXGIResource> = None;
                step("duplicate", &mut steps);
                let acquired = dupl.AcquireNextFrame(500, &mut fi, &mut res);
                step("acquire", &mut steps);
                if acquired.is_err() {
                    continue;
                }
                let res = match res {
                    Some(r) => r,
                    None => {
                        let _ = dupl.ReleaseFrame();
                        continue;
                    }
                };

                // Get the desktop texture and read its dimensions
                let src: ID3D11Texture2D = match res.cast() {
                    Ok(t) => t,
                    Err(_) => {
                        let _ = dupl.ReleaseFrame();
                        continue;
                    }
                };
                let mut src_desc = D3D11_TEXTURE2D_DESC::default();
                src.GetDesc(&mut src_desc);
                let full_w = src_desc.Width;
                let full_h = src_desc.Height;
                if full_w < 100 || full_h < 100 {
                    let _ = dupl.ReleaseFrame();
                    continue;
                }

                // Create CPU-readable staging texture (full monitor size)
                let staging_desc = D3D11_TEXTURE2D_DESC {
                    Width: full_w,
                    Height: full_h,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: src_desc.Format,
                    SampleDesc: DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: Default::default(),
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: Default::default(),
                };
                let mut staging: Option<ID3D11Texture2D> = None;
                if device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging))
                    .is_err()
                {
                    let _ = dupl.ReleaseFrame();
                    continue;
                }
                let staging = match staging {
                    Some(s) => s,
                    None => {
                        let _ = dupl.ReleaseFrame();
                        continue;
                    }
                };

                // GPU blit → staging → map to CPU
                ctx.CopyResource(
                    &staging.cast::<ID3D11Resource>().ok()?,
                    &src.cast::<ID3D11Resource>().ok()?,
                );

                // A busy game keeps the GPU from finishing the copy for
                // seconds; asking without waiting, for at most MAP_LIMIT,
                // keeps a capture from stalling until the screen changed.
                ctx.Flush();
                let staging_resource = staging.cast::<ID3D11Resource>().ok()?;
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                let asked = std::time::Instant::now();
                let map_ok = loop {
                    match ctx.Map(
                        &staging_resource,
                        0,
                        D3D11_MAP_READ,
                        D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                        Some(&mut mapped),
                    ) {
                        Ok(()) => break true,
                        Err(e)
                            if e.code() == DXGI_ERROR_WAS_STILL_DRAWING
                                && asked.elapsed() < MAP_LIMIT =>
                        {
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                        Err(_) => break false,
                    }
                };
                if !map_ok {
                    tracing::debug!(
                        waited_ms = asked.elapsed().as_millis() as u64,
                        "DXGI capture: the GPU did not finish the copy"
                    );
                    let _ = dupl.ReleaseFrame();
                    continue;
                }

                let cap_h = full_h;
                let row_pitch = mapped.RowPitch as usize;
                let src_ptr = mapped.pData as *const u8;

                // DXGI is typically BGRA. Swap R↔B if RGBA so OCR pipeline always gets BGRA.
                use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_R8G8B8A8_UNORM;
                let swap_rb = src_desc.Format == DXGI_FORMAT_R8G8B8A8_UNORM;

                let mut pixels = Vec::with_capacity((full_w * cap_h * 4) as usize);
                for row in 0..(cap_h as usize) {
                    let slice = std::slice::from_raw_parts(
                        src_ptr.add(row * row_pitch),
                        full_w as usize * 4,
                    );
                    if swap_rb {
                        for px in slice.chunks_exact(4) {
                            pixels.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
                        }
                    } else {
                        pixels.extend_from_slice(slice);
                    }
                }

                ctx.Unmap(&staging.cast::<ID3D11Resource>().ok()?, 0);
                let _ = dupl.ReleaseFrame();

                step("copy", &mut steps);
                result = Some(Frame::new(pixels, full_w, full_h));
                break 'outer;
            }
        }

        let total = started.elapsed().as_millis();
        let steps = steps
            .iter()
            .map(|(name, ms)| format!("{name} {ms} ms"))
            .collect::<Vec<_>>()
            .join(", ");
        tracing::debug!(
            total_ms = total as u64,
            found = result.is_some(),
            "DXGI capture: {steps}"
        );
        result
    }
}
