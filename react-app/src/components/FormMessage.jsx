export default function FormMessage({ text, type, as = "p", id }) {
  const Component = as;
  return (
    <Component id={id} className={`form-message ${type || ""}`.trim()}>
      {text || ""}
    </Component>
  );
}
