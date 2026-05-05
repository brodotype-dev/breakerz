import fs from 'node:fs/promises';
import path from 'node:path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const metadata = {
  title: 'Terms & Conditions — BreakIQ',
  description: 'Terms governing your use of the BreakIQ service.',
};

export const dynamic = 'force-static';

export default async function TermsPage() {
  const filePath = path.join(process.cwd(), 'docs/legal/terms-and-conditions.md');
  const content = await fs.readFile(filePath, 'utf-8');
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
