import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../primitives/actions";
import { Alert } from "../primitives/display";

type Props = { label: string; children: ReactNode };
type State = { error: Error | null };

/**
 * Catches a render error in one screen so the rest of the app keeps working.
 * "Try again" mounts the screen anew.
 * The shell gives each screen its own key, so switching screens resets it.
 */
export class ScreenBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed`, error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-4">
        <Alert
          tone="danger"
          title={`${this.props.label} ran into a problem`}
          action={
            <Button
              size="sm"
              onClick={() => {
                this.setState({ error: null });
              }}
            >
              Try again
            </Button>
          }
        >
          {error.message}
        </Alert>
      </div>
    );
  }
}
