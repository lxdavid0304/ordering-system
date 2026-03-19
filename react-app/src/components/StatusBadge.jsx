export default function StatusBadge({ children, kind = "" }) {
  return <span className={`status-badge ${kind}`.trim()}>{children}</span>;
}
