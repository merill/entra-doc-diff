import { cn } from "../../lib/utils.js";

export function Badge({ tone, className, children, ...props }) {
  return (
    <span
      className={cn("badge", tone && tone !== "neutral" && `badge-${tone}`, className)}
      {...props}
    >
      {children}
    </span>
  );
}
