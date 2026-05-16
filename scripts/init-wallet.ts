/**
 * scripts/init-wallet.ts
 *
 * Triggers the plugin's wallet creation + first-run banner. Called
 * by scripts/install.sh as the post-install step. Safe to run
 * directly too: `pnpm exec tsx scripts/init-wallet.ts`.
 */

import { resolveWallet, printFirstRunBanner } from "../plugin/src/wallet.js";

const wallet = resolveWallet();
printFirstRunBanner(wallet);

if (wallet.source !== "fresh") {
  process.stderr.write(`  Existing wallet:  ${wallet.address}\n`);
  process.stderr.write(`  Source:           ${wallet.source}\n`);
  process.stderr.write("  (Re-run is idempotent; wallet preserved.)\n\n");
}
