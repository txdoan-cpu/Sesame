import Link from "next/link";
import en from "@/messages/en.json";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-bold">{en.app.name}</h1>
      <p className="text-xl">{en.app.tagline}</p>
      <p className="rounded-lg bg-zinc-100 p-3 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {en.app.demoNotice}
      </p>
      <Link
        href="/health"
        className="inline-flex min-h-11 items-center self-start rounded-lg border-2 border-current px-5 font-medium"
      >
        {en.app.healthLink}
      </Link>
    </main>
  );
}
