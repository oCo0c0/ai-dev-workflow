export function printBanner(port: number, version: string): void {
  const url = `http://localhost:${port}`;
  const line = '═'.repeat(44);

  console.log('');
  console.log(`  ╔${line}╗`);
  console.log(`  ║       AI Dev Workbench v${version.padEnd(18)}║`);
  console.log(`  ╠${line}╣`);
  console.log(`  ║                                            ║`);
  console.log(`  ║   🚀 Server running at:                    ║`);
  console.log(`  ║   ${url.padEnd(40)}║`);
  console.log(`  ║                                            ║`);
  console.log(`  ║   Press Ctrl+C to stop                     ║`);
  console.log(`  ╚${line}╝`);
  console.log('');
}
