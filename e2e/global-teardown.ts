import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const TEST_EMAILS = [
    'test@kolamikan.local',
    'admin@kolamikan.local',
    'new@kolamikan.local',
];

const RESET_STATEMENTS = [
    `TRUNCATE TABLE
        sections,
        entries,
        canvases,
        canvas_versions,
        streams,
        cabinets,
        domains,
        personas,
        audit_logs
    CASCADE`,
    ...TEST_EMAILS.map(e => `DELETE FROM auth.users WHERE email = '${e}'`),
];

async function globalTeardown() {
    console.log('\n🧹 E2E Global Teardown: Cleaning database...\n');

    const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
        throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and key are required for e2e teardown');
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseKey,
    );

    for (const statement of RESET_STATEMENTS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await supabase.rpc('exec_sql' as any, { sql: statement });
        if (error) {
            console.error('⚠️  Teardown warning:', error.message);
        }
    }
    console.log('✅ All test data truncated');

    const authDir = path.resolve(process.cwd(), '.auth');
    if (fs.existsSync(authDir)) {
        for (const f of fs.readdirSync(authDir)) {
            fs.unlinkSync(path.join(authDir, f));
        }
        console.log('✅ Auth state files removed');
    }

    const ctxFile = path.resolve(process.cwd(), 'e2e', '.ctx-state.json');
    if (fs.existsSync(ctxFile)) {
        fs.unlinkSync(ctxFile);
    }

    console.log('\n🟢 Global teardown complete — database is clean\n');
}

export default globalTeardown;
