/**
 * @file 测试Documentation Agent
 */

import {createAgentsService} from '../agents-service';

async function testDocumentationAgent(): Promise<void> {
    console.log('🧪 测试 Documentation Agent...\n');

    try {
        const agentService = createAgentsService();

        const result = await agentService.executeAgent({
            agentType: 'documentation',
            taskId: 'doc-001',
            inputData: {
                code: `export class UserService {
    private users: Map<string, any> = new Map();

    async getUser(id: string): Promise<any> {
        return this.users.get(id);
    }

    async createUser(user: any): Promise<void> {
        this.users.set(user.id, user);
    }
}`,
                language: 'typescript',
                docType: 'generate-api-doc'
            },
            options: {
                targetQuality: 0.8,
                tokenBudget: 5000
            }
        });

        console.log(`✅ Documentation Agent测试:`);
        console.log(`  成功: ${result.success}`);
        console.log(`  质量: ${result.quality?.toFixed(2) || 'N/A'}`);
        console.log(`  耗时: ${result.duration}ms`);
        console.log(`  Token: ${result.tokensUsed}`);

        if (result.result) {
            const doc = result.result as any;
            console.log(`  文档长度: ${doc.documentation?.length || 0} 字符`);
            console.log(`  格式: ${doc.format || 'N/A'}`);
        }

    } catch (error) {
        console.error('❌ 测试失败:', error);
    }
}

testDocumentationAgent().catch(console.error);
