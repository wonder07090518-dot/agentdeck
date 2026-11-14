import { stub, detectBinary } from './index.js';
export const grok = {
  ...stub('grok'),
  detect: async () => {
    const info = await detectBinary('grok', process.env.AGENTDECK_GROK_BIN || 'grok');
    return info ? { ...info, supports: {jsonOut:false,resume:false,interactive:false,permissions:false} } : null;
  },
};
