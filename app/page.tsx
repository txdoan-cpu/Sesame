import Link from "next/link";
import en from "@/messages/en.json";

const linkClass = "inline-flex min-h-11 items-center rounded-lg border-2 border-current px-5 font-medium";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-5xl font-bold">{en.app.name}</h1>
      <p className="text-xl">{en.app.tagline}</p>
      <p className="rounded-lg bg-zinc-100 p-3 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {en.app.demoNotice}
      </p>
      <nav className="flex flex-wrap gap-3">
        <Link href="/login" className={`${linkClass} bg-blue-700 border-blue-700 text-white`}>
          {en.app.loginLink}
        </Link>
        <Link href="/signup" className={linkClass}>
          {en.app.signUpLink}
        </Link>
        <Link href="/health" className={linkClass}>
          {en.app.healthLink}
        </Link>
      </nav>
    </main>
  );
}
