import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="w-full max-w-sm rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        <h1 className="text-2xl font-semibold">Sign in to Storro</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          Continue with GitHub to access your project memory workspace.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/dashboard" });
          }}
          className="mt-6"
        >
          <Button className="w-full" type="submit">
            Continue with GitHub
          </Button>
        </form>
      </section>
    </main>
  );
}
