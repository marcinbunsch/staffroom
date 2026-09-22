import { Link } from "react-router"

export function DesignSystemSection() {
  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Design system</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        The component and token reference — tokens, core primitives, and the composed patterns the
        app is built from. It opens as its own full-page document.
      </p>
      <Link
        to="/design"
        className="mt-6 inline-flex items-center gap-2 rounded-control bg-accent-strong px-3.5 py-2 text-secondary font-medium text-ink-on-accent hover:opacity-90"
      >
        <i className="ti ti-palette" /> Open the design system
      </Link>
    </section>
  )
}
