/**
 * Keeps one page section's render error from blanking the whole page: shows the section name and
 * the error with a Retry button that renders the section again.
 */
import { Component, type ComponentChildren } from "preact";
import { t } from "@/i18n";
import c from "./controls.module.css";

interface Props {
  /** Localized section name shown in the error line. */
  name: string;
  children?: ComponentChildren;
}

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  override componentDidCatch(e: unknown): void {
    this.setState({ error: e instanceof Error ? e.message : String(e) });
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <p class={c.error} role="alert">
        <span>{t("sectionError", [this.props.name, error])}</span>
        <button type="button" class={c.btn} onClick={() => this.setState({ error: null })}>
          {t("retry")}
        </button>
      </p>
    );
  }
}
