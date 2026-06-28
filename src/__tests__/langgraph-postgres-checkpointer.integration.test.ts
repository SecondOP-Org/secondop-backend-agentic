import { Command, entrypoint, interrupt, task } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { buildLangGraphThreadId } from '../agentic/langchain/threadId';

const databaseUrl = process.env.LANGGRAPH_POSTGRES_TEST_DATABASE_URL;

const maybeDescribe = databaseUrl ? describe : describe.skip;

const composeDraft = task('sec-44-compose-draft', async (topic: string) => {
  return `Draft for ${topic}`;
});

const buildReviewWorkflow = (checkpointer: PostgresSaver) =>
  entrypoint(
    {
      name: 'sec-44-postgres-resume-test',
      checkpointer,
    },
    async (topic: string) => {
      const draft = await composeDraft(topic);
      const review = interrupt({
        question: 'Approve draft?',
        draft,
      });

      return {
        draft,
        review,
      };
    }
  );

const collectStream = async (stream: AsyncIterable<unknown>): Promise<unknown[]> => {
  const chunks: unknown[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
};

maybeDescribe('LangGraph PostgresSaver restart/resume', () => {
  const threadId = buildLangGraphThreadId(`sec-44-resume-${Date.now()}`);
  const config = {
    configurable: {
      thread_id: threadId,
    },
  };

  let firstSaver: PostgresSaver;
  let resumedSaver: PostgresSaver;

  beforeAll(async () => {
    firstSaver = PostgresSaver.fromConnString(databaseUrl!);
    resumedSaver = PostgresSaver.fromConnString(databaseUrl!);
    await firstSaver.setup();
    await firstSaver.deleteThread(threadId);
  });

  afterAll(async () => {
    if (resumedSaver) {
      await resumedSaver.deleteThread(threadId);
      await resumedSaver.end();
    }
    if (firstSaver) {
      await firstSaver.end();
    }
  });

  it('resumes an interrupted workflow from Postgres after creating a new saver instance', async () => {
    const firstWorkflow = buildReviewWorkflow(firstSaver);
    const interruptedChunks = await collectStream(await firstWorkflow.stream('cardiology', config));

    expect(JSON.stringify(interruptedChunks)).toContain('Approve draft?');

    await resumedSaver.setup();
    const resumedWorkflow = buildReviewWorkflow(resumedSaver);
    const resumedChunks = await collectStream(await resumedWorkflow.stream(new Command({ resume: 'approved' }), config));

    expect(JSON.stringify(resumedChunks)).toContain('Draft for cardiology');
    expect(JSON.stringify(resumedChunks)).toContain('approved');
  });
});
