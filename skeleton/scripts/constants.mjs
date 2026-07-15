export const MODULE_ID = "{{MODULE_ID}}";
export const LANG_PREFIX = "{{LANG_PREFIX}}";

/**
 * Namespacing (see acks-module-template docs/TOOLCHAIN.md — enforced by
 * tools/validate.mjs): identifiers in shared registries carry the module key.
 * MODULE_KEY prefixes pack document _ids (declared in module.json
 * flags.{{MODULE_ID}}.idPrefix); NAMESPACE prefixes globalThis exposures,
 * custom hook names, and Handlebars helpers.
 */
export const MODULE_KEY = "{{MODULE_KEY}}";
export const NAMESPACE = "{{MODULE_NAMESPACE}}";
