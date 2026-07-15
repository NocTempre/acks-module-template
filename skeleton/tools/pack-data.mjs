/**
 * Module-owned compendium document content, consumed by the synced
 * tools/build-packs.mjs harness.
 *
 * Contract: export a `packs` map of pack name -> documents (array, or a
 * zero-arg function returning one). Every top-level document needs:
 *   _id   16 alphanumeric characters, unique within the pack
 *   _key  "!<collection>!<_id>" (e.g. "!items!<id>", "!macros!<id>",
 *         "!tables!<id>"); embedded documents use
 *         "!items.effects!<parentId>.<childId>" style keys
 * Large datasets may live in sibling files (e.g. bestiary-data.mjs) and be
 * re-exported through this map.
 */

export const packs = {
  // "{{MODULE_ID}}-examples": () => [
  //   {
  //     _id: "aaaaaaaaaaaaaaaa",
  //     _key: "!items!aaaaaaaaaaaaaaaa",
  //     name: "Example",
  //     type: "item",
  //     img: "icons/svg/book.svg",
  //     system: {},
  //   },
  // ],
};
