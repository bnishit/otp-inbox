# Afterspan SDK

`afterspan-sdk-e950b01.tgz` is built from bnishit/native-analytics commit
`e950b0102c7a4e6ce9fe0d0ac29eb19b73172014` with `npm ci --ignore-scripts`,
`npm run build:sdk` and `npm pack`. It includes the MIT license.

The built artifact avoids running a Git dependency's TypeScript build on Bun
production installs. Its exact bytes are pinned by bun.lock. Never put a
producer key in this artifact or in the extension.
