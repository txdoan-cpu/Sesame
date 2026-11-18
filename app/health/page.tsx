import type { Metadata } from "next";
import Link from "next/link";
import en from "@/messages/en.json";
import { HealthStatus } from "./HealthStatus";

export const metadata: Metadata = { title: "Health — Sesame" };

export default function HealthPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-bold">{en.health.title}</h1>
      <p className="text-lg">{en.health.intro}</p>
      <HealthStatus />
      <Link href="/" className="inline-flex min-h-11 items-center self-start underline">
        {en.health.back}
      </Link>
    </main>
  );
}
