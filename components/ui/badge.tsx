import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "border-[color:var(--border)] bg-[color:var(--surface-alt)] text-[color:var(--muted)]",
        accent: "border-blue-200 bg-blue-50 text-blue-700",
        success: "border-teal-200 bg-teal-50 text-teal-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        danger: "border-red-200 bg-red-50 text-red-700",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
