/**
 * 启动横幅模块
 *
 * 在终端输出格式化的 ASCII 启动横幅，显示服务版本和访问地址。
 */

/**
 * 打印启动横幅到终端
 *
 * @param port - 服务监听端口号
 * @param version - 应用版本号
 */
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
