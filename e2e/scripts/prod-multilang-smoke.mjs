import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

const CASES = [
  { path: 'main.py', code: "print('py ok', 1+1)", expect: 'py ok 2' },
  { path: 'main.js', code: "console.log('js ok', 1+1)", expect: 'js ok 2' },
  { path: 'main.ts', code: "const x: number = 1+1;\nconsole.log('ts ok', x)", expect: 'ts ok 2' },
  { path: 'main.c', code: '#include <stdio.h>\nint main(){printf("c ok %d\\n",1+1);return 0;}', expect: 'c ok 2' },
  { path: 'main.cpp', code: '#include <iostream>\nint main(){std::cout<<"cpp ok "<<1+1<<"\\n";return 0;}', expect: 'cpp ok 2' },
  { path: 'main.go', code: 'package main\nimport "fmt"\nfunc main(){fmt.Println("go ok", 1+1)}', expect: 'go ok 2' },
  { path: 'main.rs', code: 'fn main(){println!("rust ok {}", 1+1);}', expect: 'rust ok 2' },
  { path: 'Main.java', code: 'public class Main{public static void main(String[] a){System.out.println("java ok "+(1+1));}}', expect: 'java ok 2' },
  { path: 'Main.cs', code: 'using System;\nclass Program{static void Main(){Console.WriteLine("cs ok "+(1+1));}}', expect: 'cs ok 2' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console:error]', msg.text()); });

const results = [];

try {
  const email = `prod-multilang-${stamp}@example.com`;
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill('Prod Multilang');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 15000 });

  await page.getByPlaceholder('New room name').fill('Multilang Smoke');
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 15000 });
  await page.waitForSelector('.monaco-editor', { state: 'visible' });
  await page.waitForSelector('text=Connected', { timeout: 15000 });

  for (const c of CASES) {
    try {
      // create a new file for this language (the default main.py already exists)
      if (c.path !== 'main.py') {
        page.once('dialog', (dialog) => dialog.accept(c.path));
        await page.getByRole('button', { name: '+', exact: true }).click();
        await page.waitForTimeout(300);
      }
      await page.getByText(c.path, { exact: true }).click();
      await page.waitForTimeout(300);
      await page.click('.monaco-editor');
      await page.keyboard.press('Control+A');
      await page.keyboard.type(c.code, { delay: 5 });

      const previousOutput = (await page.locator('.execution-output').textContent()) || '';
      const runBtn = page.getByRole('button', { name: new RegExp(`^Run ${c.path.replace('.', '\\.')}`) });
      await runBtn.click();

      let output = previousOutput;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        output = (await page.locator('.execution-output').textContent()) || '';
        if (output.trim().length > 0 && output !== previousOutput) break;
        await page.waitForTimeout(300);
      }
      const pass = output.includes(c.expect);
      results.push({ lang: c.path, pass, output: output.slice(0, 200) });
      console.log(`[${pass ? 'PASS' : 'FAIL'}] ${c.path}: ${JSON.stringify(output.slice(0, 150))}`);
    } catch (err) {
      results.push({ lang: c.path, pass: false, output: `ERROR: ${err.message}` });
      console.log(`[FAIL] ${c.path}: ERROR ${err.message}`);
    }
  }

  await page.screenshot({ path: 'scripts/prod-multilang-result.png' });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} languages passed on production.`);
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.lang).join(', '));
  process.exitCode = 1;
}
