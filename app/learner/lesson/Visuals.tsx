import type { VisualView } from "@/lib/lesson/view";

/** Slide visuals. Math HTML comes pre-rendered (KaTeX) from the server. */
export function Visual({ visual }: { visual: VisualView }) {
  switch (visual.type) {
    case "none":
      return null;
    case "balance":
      return <Balance {...visual} />;
    case "tiles":
      return <Tiles {...visual} />;
    case "steps":
      return <Steps {...visual} />;
    case "compare":
      return <Compare {...visual} />;
  }
}

function MathSpan({ html, className = "" }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Balance({ leftHtml, rightHtml, tilt }: { leftHtml: string; rightHtml: string; tilt: "left" | "right" | null }) {
  const rotate = tilt === "left" ? "-rotate-6" : tilt === "right" ? "rotate-6" : "";
  return (
    <figure className="flex flex-col items-center gap-2 py-2" aria-label="Balance scale">
      <div className={`flex w-full max-w-md items-end justify-between transition-transform ${rotate}`}>
        <div className="flex min-w-[40%] justify-center rounded-lg border-2 border-blue-700 bg-blue-50 px-3 py-3 text-xl text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          <MathSpan html={leftHtml} />
        </div>
        <div className="flex min-w-[40%] justify-center rounded-lg border-2 border-blue-700 bg-blue-50 px-3 py-3 text-xl text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          <MathSpan html={rightHtml} />
        </div>
      </div>
      <div className={`h-2 w-full max-w-md rounded bg-zinc-700 dark:bg-zinc-300 ${rotate}`} />
      <div className="h-0 w-0 border-x-[1.5rem] border-b-[2rem] border-x-transparent border-b-zinc-700 dark:border-b-zinc-300" />
    </figure>
  );
}

function XTile() {
  return (
    <span className="inline-flex h-12 w-6 items-center justify-center rounded border-2 border-green-800 bg-green-600 text-sm font-bold text-white">
      x
    </span>
  );
}

function UnitTile() {
  return <span className="inline-block h-6 w-6 rounded border-2 border-amber-700 bg-amber-300" />;
}

function Tiles({ groups, unitsPerGroup, rightUnits }: { groups: number; unitsPerGroup: number; rightUnits: number }) {
  return (
    <figure
      className="flex flex-col gap-4 md:flex-row md:items-center md:justify-center"
      aria-label={`Algebra tiles: ${groups} groups of one x-tile and ${unitsPerGroup} one-tiles, equal to ${rightUnits} one-tiles`}
    >
      <div className="flex flex-col gap-2 rounded-lg border-2 border-zinc-400 p-3">
        {Array.from({ length: groups }, (_, g) => (
          <div key={g} className="flex items-center gap-1 rounded border border-dashed border-zinc-500 p-1">
            <XTile />
            {Array.from({ length: unitsPerGroup }, (_, u) => (
              <UnitTile key={u} />
            ))}
          </div>
        ))}
      </div>
      <span className="text-center text-3xl font-bold" aria-hidden>
        =
      </span>
      <div className="flex max-w-xs flex-wrap gap-1 rounded-lg border-2 border-zinc-400 p-3">
        {Array.from({ length: rightUnits }, (_, u) => (
          <UnitTile key={u} />
        ))}
      </div>
      <figcaption className="sr-only">Green tall tile is x. Small yellow square is 1.</figcaption>
    </figure>
  );
}

function Steps({ linesHtml, hiddenLine, checkHtml }: { linesHtml: string[]; hiddenLine: number | null; checkHtml: string | null }) {
  return (
    <ol className="flex flex-col gap-2 text-xl" aria-label="Steps">
      {linesHtml.map((html, i) =>
        i === hiddenLine ? (
          <li key={i} className="rounded-lg border-2 border-dashed border-blue-700 px-3 py-2 text-blue-800 dark:text-blue-200">
            ?
          </li>
        ) : (
          <li key={i} className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
            <MathSpan html={html} />
          </li>
        ),
      )}
      {checkHtml && (
        <li className="rounded-lg border-2 border-green-700 px-3 py-2">
          ✓ <MathSpan html={checkHtml} />
        </li>
      )}
    </ol>
  );
}

function Compare({ equationHtml, people }: { equationHtml: string; people: { name: string; linesHtml: string[] }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-center text-xl">
        <MathSpan html={equationHtml} />
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {people.map((p) => (
          <section key={p.name} aria-label={`${p.name}'s work`} className="rounded-lg border-2 border-zinc-400 p-3">
            <h3 className="mb-2 text-lg font-semibold">{p.name}</h3>
            <ol className="flex flex-col gap-1 text-xl">
              {p.linesHtml.map((html, i) => (
                <li key={i}>
                  <MathSpan html={html} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
