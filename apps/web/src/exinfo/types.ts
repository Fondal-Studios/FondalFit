/** How-to content per exercise: steps separated by " | ", and one key cue. Triples are [es, en, pt]. `n` only where a name is not already in i18n. */
export interface ExInfo { n?: [string, string, string]; how: [string, string, string]; tip: [string, string, string] }
export const x = (n: [string, string, string] | null, how: [string, string, string], tip: [string, string, string]): ExInfo => (n ? { n, how, tip } : { how, tip });
