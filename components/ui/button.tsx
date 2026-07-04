import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[color:var(--foreground)] text-white hover:bg-black focus-visible:outline-[color:var(--accent)]",
        secondary:
          "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--background)] focus-visible:outline-[color:var(--accent)]",
        subtle:
          "bg-[color:var(--surface-alt)] text-[color:var(--foreground)] hover:bg-[color:var(--border)] focus-visible:outline-[color:var(--accent)]",
        ghost:
          "text-[color:var(--foreground)] hover:bg-[color:var(--surface-alt)] focus-visible:outline-[color:var(--accent)]",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ asChild = false, className, size, variant, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ size, variant }), className)} {...props} />;
}
