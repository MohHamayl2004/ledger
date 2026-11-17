#!/usr/bin/env node
/* ================================================================
   MCP على الجهاز (stdio) — لـ Claude Code / Claude Desktop
   ----------------------------------------------------------------
   الأدوات نفسها بـ core/tools.js (نفس اللي على Cloudflare).

   المتغيرات المطلوبة (بتنحط بإعدادات MCP، مش بالكود):
     FIREBASE_EMAIL, FIREBASE_PASSWORD   (نفس دخول الموقع)
     UNITED_LOGIN, UNITED_PASSWORD       (بس للإرسال ليونايتد)
   ================================================================ */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FIREBASE_CONFIG } from '../js/config.js';
import { endpoints, signIn, refresh, Firestore } from './core/firestore.js';
import { registerTools, SERVER_INFO, INSTRUCTIONS } from './core/tools.js';

const log = (...a) => console.error('[laqta-mcp]', ...a); // stdout محجوز لبروتوكول MCP

const ep = endpoints(process.env.FIREBASE_EMULATOR === '1');
const apiKey = FIREBASE_CONFIG.apiKey;

const email = process.env.FIREBASE_EMAIL;
const password = process.env.FIREBASE_PASSWORD;
if (!email || !password) {
  log('ناقص FIREBASE_EMAIL أو FIREBASE_PASSWORD بإعدادات الـ MCP');
  process.exit(1);
}

let session = await signIn(ep, apiKey, email, password);
const getToken = async () => {
  if (Date.now() > session.expiresAt - 5 * 60 * 1000) {
    const r = await refresh(ep, apiKey, session.refreshToken);
    session = Object.assign(session, r);
  }
  return session.idToken;
};
const fs = new Firestore({ ep, projectId: FIREBASE_CONFIG.projectId, getToken });

if (!(await fs.get('members', session.uid))) {
  log('هذا الحساب مش عضو بالموقع (ما في members/' + session.uid + ')');
  process.exit(1);
}

const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
registerTools(server, {
  fs,
  uid: session.uid,
  unitedCreds: () => ({ login: process.env.UNITED_LOGIN, password: process.env.UNITED_PASSWORD })
});

await server.connect(new StdioServerTransport());
log('ready');
