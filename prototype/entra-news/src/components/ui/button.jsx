import { cn } from "../../lib/utils.js";

export function Button({ variant = "default", size = "default", className, children, ...props }) {
  return (
    <button
      className={cn(
        "button",
        `button-${variant}`,
        size === "icon" ? "button-icon" : "button-default-size",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
