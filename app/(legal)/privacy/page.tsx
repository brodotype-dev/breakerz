import fs from 'node:fs/promises';
import path from 'node:path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const metadata = {
  title: 'Privacy Policy — BreakIQ',
  description: 'How BreakIQ collects, uses, and protects your information.',
};

export const dynamic = 'force-static';

export default async function PrivacyPolicyPage() {
  const filePath = path.join(process.cwd(), 'docs/legal/privacy-policy.md');
  const content = await fs.readFile(filePath, 'utf-8');
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
