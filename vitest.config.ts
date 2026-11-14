import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:{'@agentdeck/protocol':fileURLToPath(new URL('./packages/protocol/src/index.ts',import.meta.url)),'@agentdeck/adapters':fileURLToPath(new URL('./packages/adapters/src/index.ts',import.meta.url))}},test:{testTimeout:10000}});
