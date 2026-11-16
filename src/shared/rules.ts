import type { Rules } from "./types";
const sets = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
};
export function pools(r: Rules) {
  const filter = (s: string) =>
    [...new Set(s)]
      .filter(
        (c) =>
          !r.excluded.includes(c) &&
          (!r.ambiguous || !"0O1lI".includes(c)) &&
          (!r.allowed || r.allowed.includes(c)),
      )
      .join("");
  return [
    filter(r.upper ? sets.upper : ""),
    filter(r.lower ? sets.lower : ""),
    filter(r.numbers ? sets.numbers : ""),
    filter(
      r.symbols
        ? [...r.allowedSymbols].filter((c) => !/^[A-Za-z0-9]$/.test(c)).join("")
        : "",
    ),
  ];
}
export function validateSecret(value: string, r: Rules): string[] {
  const errors: string[] = [];
  if ([...value].length < r.min)
    errors.push(`Use at least ${r.min} characters.`);
  if ([...value].length > r.max) errors.push(`Maximum length is ${r.max}.`);
  if (r.truncates && [...value].length > r.truncates)
    errors.push(`This service truncates at ${r.truncates} characters.`);
  if (r.allowed && [...value].some((c) => !r.allowed.includes(c)))
    errors.push("Contains characters outside the allowed set.");
  if ([...value].some((c) => r.excluded.includes(c)))
    errors.push("Contains excluded characters.");
  const counts = [/[A-Z]/g, /[a-z]/g, /[0-9]/g, /[^A-Za-z0-9]/gu].map(
    (re) => (value.match(re) || []).length,
  );
  const mins = [
    r.upper ? r.minUpper : 0,
    r.lower ? r.minLower : 0,
    r.numbers ? r.minNumbers : 0,
    r.symbols ? r.minSymbols : 0,
  ];
  if (counts.some((n, i) => n < mins[i]))
    errors.push("Required character counts are not met.");
  if (r.noRepeat && /([\s\S])\1/u.test(value))
    errors.push("Consecutive repeated characters are not allowed.");
  return errors;
}
export function manualWarnings(value: string): string[] {
  return [
    ...(value !== value.trim()
      ? ["Leading or trailing spaces will be preserved."]
      : []),
    ...(/[0O1lI]/.test(value)
      ? ["Contains look-alike characters (0/O or 1/l/I)."]
      : []),
  ];
}
// Uniformly sampled local words; entropy is word count × log2(WORDS.length).
export const WORDS =
  "acorn amber anchor apple apron arch arrow atlas autumn badge bamboo basin beach beacon berry birch blade bloom blue board boat bold bolt book boot bottle branch brass breeze brick bridge brook brush bubble bucket cabin cactus candle canyon cape cargo cedar chair chalk charm cherry chest circle citrus clay cliff cloud clover coast cobalt comet coral cotton crane creek crest crown crystal dawn deer delta desert dew diamond drift dune eagle earth echo elm ember engine fabric falcon feather fern field finch fire flame flask fleet flint float flower flute foam forest fork fox frame frost fruit garden gate gem ghost giant ginger glass globe glow gold goose grain grape grass green grove gull harbor harvest hawk hazel heart hedge heron hill honey horse ice iris island ivory ivy jade jar jasmine jewel juniper kettle key kite lake lamp lantern lark leaf lemon lens light lilac lime linen lion lotus lunar maple marble marsh meadow melon metal mint mist moon moss mountain mouse nest night north oak ocean olive onion opal orange orbit orchid otter owl palm panda paper peach pearl pebble pecan pine pink pipe planet plum pocket pond poppy port prism pumpkin quartz queen quill quilt rabbit rain raven reed reef ridge ring river road robin rock rose ruby sage sail salt sand satin scarf seed shade shell shore silk silver sky slate snow soap solar song south space sparrow spice spoon spring spruce square star steel stem stone storm straw stream sugar summer sun surf swan table tea teal thorn thyme tide tiger timber toast torch tower trail tree tulip turtle valley velvet vine violet walnut water wave wax west wheat wheel white willow wind wing winter wolf wood wren yellow zebra zinc".split(
    " ",
  );
export function generate(r: Rules, randomInt: (max: number) => number): string {
  if (r.mode === "passphrase") {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const v = Array.from({ length: r.words }, () => {
        const w = WORDS[randomInt(WORDS.length)];
        return r.capitalize ? w[0].toUpperCase() + w.slice(1) : w;
      }).join(r.separator);
      if (!validateSecret(v, r).length) return v;
    }
    throw Error(
      "Passphrase cannot satisfy these rules. Turn off required digits/symbols or adjust the rules.",
    );
  }
  const ps = pools(r).map((p) => [...p]),
    mins = [
      r.upper ? r.minUpper : 0,
      r.lower ? r.minLower : 0,
      r.numbers ? r.minNumbers : 0,
      r.symbols ? r.minSymbols : 0,
    ],
    all = [...new Set(ps.flat())];
  if (
    r.length < r.min ||
    r.length > r.max ||
    (r.truncates && r.length > r.truncates) ||
    !all.length ||
    mins.reduce((a, b) => a + b, 0) > r.length ||
    ps.some((p, i) => !p.length && mins[i] > 0) ||
    (r.noRepeat && all.length === 1 && r.length > 1)
  )
    throw Error(
      "Impossible rule combination. Check length, character sets, and minimum counts.",
    );
  for (let attempt = 0; attempt < 2000; attempt++) {
    const characters: string[] = [];
    const remaining = [...mins];
    while (characters.length < r.length) {
      const slots = r.length - characters.length - 1;
      const previous = characters[characters.length - 1];
      const candidates = all.filter((character) => {
        if (r.noRepeat && character === previous) return false;
        const next = [...remaining];
        const group = ps.findIndex((pool) => pool.includes(character));
        if (group >= 0 && next[group] > 0) next[group]--;
        if (next.reduce((sum, count) => sum + count, 0) > slots) return false;
        if (
          r.noRepeat &&
          ps.some(
            (pool, i) =>
              pool.length === 1 &&
              next[i] >
                Math.floor((slots + (character === pool[0] ? 0 : 1)) / 2),
          )
        )
          return false;
        return true;
      });
      if (!candidates.length) break;
      const chosen = candidates[randomInt(candidates.length)];
      const group = ps.findIndex((pool) => pool.includes(chosen));
      if (group >= 0 && remaining[group] > 0) remaining[group]--;
      characters.push(chosen);
    }
    const value = characters.join("");
    if (characters.length === r.length && !validateSecret(value, r).length)
      return value;
  }
  throw Error("Could not satisfy these rules. Relax the constraints.");
}
