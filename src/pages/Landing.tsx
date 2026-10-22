import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router";

const EASE = [0.16, 1, 0.3, 1] as const;

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.7, ease: EASE },
};

const STEPS = [
  {
    n: "01",
    title: "Search, tap or locate",
    body: "Type a place into the station catalog, click anywhere on the map, or let Quick Tides use your GPS position.",
  },
  {
    n: "02",
    title: "Read the tide",
    body: "The next high and low water with exact times, heights in feet, local time and a countdown that keeps ticking.",
  },
  {
    n: "03",
    title: "See the whole curve",
    body: "Forty-eight hours of water level for that point, with every high and low marked on the line.",
  },
];

const SPECS: [string, string][] = [
  [
    "Station catalog",
    "Every NOAA tide gauge in one searchable list — by name, state or station number — sorted nearest-first once you share your location.",
  ],
  [
    "Next tide",
    "High or low water with the exact time, how high the water gets, and a countdown that keeps ticking.",
  ],
  [
    "48-hour curve",
    "The full water-level curve for the point you picked, every extreme marked on the line.",
  ],
  [
    "Local time",
    "Times are rendered in the timezone of the place you selected — not the one on your device.",
  ],
  [
    "No sign-in",
    "Anyone, anywhere, at any time: the map opens and works. Nothing to create, nothing to remember, nothing to explain.",
  ],
];

/** Decorative semi-diurnal curve used as the hero artwork. */
function TideCurveArt() {
  const W = 1200;
  const H = 200;
  const samples = Array.from({ length: 241 }, (_, i) => {
    const t = i / 240;
    const x = t * W;
    const y =
      H / 2 -
      (Math.sin(t * Math.PI * 4) * 44 + Math.sin(t * Math.PI * 4 + 1.1) * 14);
    return { x, y };
  });
  const line = samples
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const marks: { x: number; y: number }[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1].y;
    const next = samples[i + 1].y;
    const curr = samples[i].y;
    if ((curr <= prev && curr < next) || (curr >= prev && curr > next)) {
      marks.push(samples[i]);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-40 w-full sm:h-56"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="landingTideFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#222f3b" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#222f3b" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={(i / 4) * W}
          y1="0"
          x2={(i / 4) * W}
          y2={H}
          stroke="#abb8bf"
          strokeWidth="1"
        />
      ))}
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#abb8bf" />
      <path d={area} fill="url(#landingTideFill)" />
      <path d={line} fill="none" stroke="#222f3b" strokeWidth="1.5" />
      {marks.map((m) => (
        <circle
          key={`${m.x}`}
          cx={m.x}
          cy={m.y}
          r="4"
          fill="#e3eff3"
          stroke="#222f3b"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <span className="text-sm font-medium uppercase tracking-[0.34em]">
            Quick Tides
          </span>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Open the map
          </button>
        </div>
      </header>

      <main>
        <section className="mx-auto w-full max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
            className="pt-24 pb-14 sm:pt-32"
          >
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              Tide times · anywhere on earth
            </p>
            <h1 className="mt-8 text-5xl font-light leading-[1.03] tracking-tight sm:text-7xl">
              Find tide times
              <br />
              anywhere on earth.
            </h1>
            <p className="mt-8 max-w-xl text-base leading-7 text-muted-foreground">
              Search the station catalog, tap a point on the map, or use your
              GPS location — Quick Tides returns the next high and low water for
              that exact spot, with the 48-hour curve behind it. No account and
              no sign-in.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="group inline-flex items-center gap-3 bg-foreground px-6 py-3.5 text-sm text-background transition-opacity hover:opacity-85"
              >
                Open Quick Tides
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40"
              >
                Browse the station catalog
              </button>
            </div>
            <p className="mt-6 text-xs tracking-[0.04em] text-muted-foreground">
              Free to use · Nothing to install · Works in any modern browser
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, ease: EASE, delay: 0.25 }}
            className="pb-6"
          >
            <TideCurveArt />
            <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>00:00</span>
              <span className="hidden sm:inline">06:00</span>
              <span>12:00</span>
              <span className="hidden sm:inline">18:00</span>
              <span>24:00</span>
            </div>
          </motion.div>
        </section>

        <motion.section
          {...fadeUp}
          className="mt-16 border-t border-border sm:mt-24"
        >
          <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 sm:grid-cols-3 sm:gap-0 sm:py-20">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="sm:border-l sm:border-border sm:pl-8 sm:first:border-l-0 sm:first:pl-0"
              >
                <span className="text-[11px] tracking-[0.2em] text-muted-foreground">
                  {step.n}
                </span>
                <h2 className="mt-4 text-base font-medium tracking-tight">
                  {step.title}
                </h2>
                <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section {...fadeUp} className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20">
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              What you get
            </p>
            <dl className="mt-8 border-t border-border">
              {SPECS.map(([term, detail]) => (
                <div
                  key={term}
                  className="grid gap-1 border-b border-border py-5 sm:grid-cols-[13rem_1fr] sm:gap-8"
                >
                  <dt className="text-sm font-medium tracking-tight">{term}</dt>
                  <dd className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    {detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </motion.section>

        <motion.section {...fadeUp} className="border-t border-border">
          <div className="mx-auto grid w-full max-w-5xl gap-6 px-6 py-16 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:py-20">
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              Made for your customers
            </p>
            <div>
              <h2 className="max-w-lg text-2xl font-light tracking-tight sm:text-3xl">
                A tide tool you can hand to anyone
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                Quick Tides is built for the customers of marinas, tackle shops,
                charter boats and coastal tourism businesses. Share it on a
                website, on a screen in the shop, or as a link in a booking
                confirmation — there is nothing to explain, because there is
                nothing to sign up for. It opens on a world map and works the
                moment it loads.
              </p>
            </div>
          </div>
        </motion.section>

        <motion.section {...fadeUp} className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 text-center sm:py-28">
            <h2 className="text-3xl font-light tracking-tight sm:text-4xl">
              Check the tide before you go.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Open the map, pick your spot, and know when the water is going to
              move.
            </p>
            <div className="mt-9">
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="group inline-flex items-center gap-3 border border-foreground px-6 py-3.5 text-sm transition-colors hover:bg-foreground hover:text-background"
              >
                Open Quick Tides
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </motion.section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 text-[11px] tracking-[0.04em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="uppercase tracking-[0.22em]">Quick Tides</span>
          <span>
            Tide data: NOAA CO-OPS · WorldTides — Basemap: OpenStreetMap,
            CARTO
          </span>
        </div>
      </footer>
    </div>
  );
}
