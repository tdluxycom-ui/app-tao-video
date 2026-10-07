# Pinned Muse client source

Vendored from [minhquan130599/MuseAI-API](https://github.com/minhquan130599/MuseAI-API) at commit `bf964f7c022f11a3574e2e17a8ec57e7c9b0e596`.

The `.git` metadata of the upstream checkout is excluded from the parent project; the Python source and upstream README are kept here for reproducibility and attribution. The upstream project describes itself as an unofficial client for Muse.ai's private Hatch/Noise protocol. Review its terms and the Muse.ai terms before deployment or commercial use. Update this pinned source only after reviewing the upstream change.
# Local integration patch

`muse_ai/client.py` accepts an optional `max_bytes` for video downloads. The bridge uses this to reject media exceeding its reserved disk allowance before writing; the upstream transport can still buffer media in memory. Preserve this patch when updating the vendored client.
