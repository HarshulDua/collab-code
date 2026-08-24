import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

let pass = true;
const check = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

async function register(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`term-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 25000 });
}

async function openTerminal(page) {
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.terminal-input').waitFor({ state: 'visible', timeout: 15000 });
}

async function runCmd(page, command) {
  const input = page.locator('.terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.locator('.terminal-input:not([disabled])').waitFor({ timeout: 60000 });
  await page.waitForTimeout(200);
  const lines = await page.locator('.terminal-line').allTextContents();
  return lines[lines.length - 1] || '';
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  await register(page, 'TermProd');
  await page.getByPlaceholder('New room name').fill('Terminal Prod Room');
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 25000 });
  await page.waitForSelector('.monaco-editor', { state: 'visible' });
  await page.waitForSelector('text=Connected', { timeout: 25000 });
  await openTerminal(page);

  // ---- file handling ----
  check('help lists commands', (await runCmd(page, 'help')).includes('mkdir'));
  check('ls shows the default file', (await runCmd(page, 'ls')).includes('main.py'));
  await runCmd(page, 'mkdir src');
  check('mkdir then ls shows the directory', (await runCmd(page, 'ls')).includes('src/'));
  await runCmd(page, 'cd src');
  check('cd + pwd', (await runCmd(page, 'pwd')).includes('/src'));
  await runCmd(page, 'echo created_in_terminal > note.txt');
  check('echo > then cat', (await runCmd(page, 'cat note.txt')).includes('created_in_terminal'));
  await runCmd(page, 'echo second_line >> note.txt');
  check('echo >> appends', (await runCmd(page, 'cat note.txt')).includes('second_line'));
  await runCmd(page, 'cp note.txt copy.txt');
  check('cp', (await runCmd(page, 'ls')).includes('copy.txt'));
  await runCmd(page, 'mv copy.txt moved.txt');
  const afterMv = await runCmd(page, 'ls');
  check('mv renames', afterMv.includes('moved.txt') && !afterMv.includes('copy.txt'));
  await runCmd(page, 'cd ..');
  check('cd .. returns to root', (await runCmd(page, 'pwd')).trim().endsWith('/'));
  check('file explorer reflects terminal files', await page.locator('.file-tree-name', { hasText: 'note.txt' }).isVisible());

  // ---- safety ----
  check('unknown command refused', (await runCmd(page, 'sudo rm -rf /')).includes('command not found'));
  const escape = await runCmd(page, 'cat ../../../etc/passwd');
  check('path escape blocked', !escape.includes('root:'), escape.slice(0, 40));
  check('bad cd errors cleanly', (await runCmd(page, 'cd nope')).includes('no such directory'));

  // ---- run: all nine languages ----
  const langs = [
    ['py.py', 'print("PY_OK")', 'run py.py', 'PY_OK'],
    ['js.js', 'console.log("JS_OK")', 'node js.js', 'JS_OK'],
    ['ts.ts', 'const m: string = "TS_OK"; console.log(m)', 'run ts.ts', 'TS_OK'],
    ['c.c', '#include <stdio.h>\\nint main(){printf("C_OK\\\\n");return 0;}', 'run c.c', 'C_OK'],
    ['cpp.cpp', '#include <iostream>\\nint main(){std::cout<<"CPP_OK"<<std::endl;return 0;}', 'run cpp.cpp', 'CPP_OK'],
    ['go.go', 'package main\\nimport "fmt"\\nfunc main(){fmt.Println("GO_OK")}', 'go run go.go', 'GO_OK'],
    ['rs.rs', 'fn main(){println!("RS_OK");}', 'run rs.rs', 'RS_OK'],
    ['Main.java', 'public class Main{public static void main(String[] a){System.out.println("JAVA_OK");}}', 'run Main.java', 'JAVA_OK'],
    ['Cs.cs', 'using System;class P{static void Main(){Console.WriteLine("CS_OK");}}', 'run Cs.cs', 'CS_OK'],
  ];

  for (const [file, source, command, expected] of langs) {
    // Write the source through the editor rather than echo, so multi-line
    // and quoted code survives verbatim.
    await page.evaluate(
      ([f, src]) => {
        window.__termSeed = { f, src };
      },
      [file, source]
    );
    await runCmd(page, `touch ${file}`);
    await page.locator('.file-tree-name', { hasText: file }).click();
    await page.waitForTimeout(600);
    await page.click('.monaco-editor');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(source.replace(/\\n/g, '\n').replace(/\\\\n/g, '\\n'), { delay: 5 });
    await page.waitForTimeout(600);
    await openTerminal(page);
    const out = await runCmd(page, command);
    check(`run ${file}`, out.includes(expected), out.replace(/\n/g, ' ').slice(0, 70));
  }

  // ---- git ----
  check('git status', (await runCmd(page, 'git status')).includes('On branch main'));
  const commitOut = await runCmd(page, 'git commit -m "from prod terminal"');
  check('git commit', /\[main [0-9a-f]{7}\]/.test(commitOut), commitOut.trim());
  check('git status clean after commit', (await runCmd(page, 'git status')).includes('nothing to commit'));
  check('git log shows the commit', (await runCmd(page, 'git log')).includes('from prod terminal'));
  check('git branch marks current', (await runCmd(page, 'git branch')).includes('* main'));
  check('git diff returns a patch', (await runCmd(page, 'git diff')).length > 0);
  check('git add explains itself', (await runCmd(page, 'git add .')).toLowerCase().includes('staging'));
  await runCmd(page, 'git checkout -b prod-term-branch');
  await page.waitForTimeout(2500);
  check('git checkout -b switches the room', (await page.locator('.room-branch').textContent()).includes('prod-term-branch'));

  await page.screenshot({ path: 'scripts/prod-terminal.png', fullPage: true });
} catch (err) {
  console.log('EXCEPTION:', err.message);
  pass = false;
} finally {
  await ctx.close();
  await browser.close();
}

console.log(pass ? '\nAll terminal checks passed on production.' : '\nSome terminal checks FAILED.');
process.exitCode = pass ? 0 : 1;
