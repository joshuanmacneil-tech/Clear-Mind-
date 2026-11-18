import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "index.html should contain the application script");
const appScript = scriptMatch[1].replace(/\ninitialize\(\);\s*$/, "\n");

function createFrontend() {
  const storage = new Map();
  const context = vm.createContext({
    window: {},
    document: { addEventListener() {} },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    }
  });
  vm.runInContext(appScript, context);
  return {
    context,
    storage,
    run(source) {
      return vm.runInContext(source, context);
    },
    evaluateReply(reply) {
      context.testReply = reply;
      return JSON.parse(JSON.stringify(vm.runInContext(
        "processAIActionTags(testReply, state.aiMessages)",
        context
      )));
    },
    getTasks() {
      return JSON.parse(JSON.stringify(vm.runInContext("state.tasks", context)));
    }
  };
}

function setMessages(frontend, messages) {
  frontend.context.testMessages = JSON.stringify(messages);
  frontend.run("state.aiMessages = JSON.parse(testMessages); state.activeFocusTaskId = null;");
}

describe("Brain Dump task confirmation flow", () => {
  it("asks for confirmation before adding an actionable task", () => {
    const frontend = createFrontend();
    setMessages(frontend, [{ role: "user", text: "I should book an appointment." }]);

    const result = frontend.evaluateReply("[CONFIRM_TASK: Book appointment]");

    assert.match(result.text, /Would you like me to add.*Book appointment.*My List\?/);
    assert.deepEqual(result.taskConfirmation, { status: "pending", title: "Book appointment" });
    assert.deepEqual(frontend.getTasks(), []);

    const unrelatedQuestion = frontend.evaluateReply(
      "A walk might help you reset. Would you like to go now?\n[CONFIRM_TASK: Book appointment]"
    );
    assert.match(unrelatedQuestion.text, /Would you like me to add “Book appointment” to My List\?/);
  });

  it("adds and saves a task only after a clear affirmative reply", () => {
    const frontend = createFrontend();
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment to your My List?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "Yes, please.", taskConfirmation: { status: "confirmed", title: "Book appointment" } }
    ]);

    const result = frontend.evaluateReply("I’ve added it to your list.\n[ADD_TASK: Book appointment]");

    assert.equal(result.taskAction.type, "added");
    assert.equal(result.taskAction.title, "Book appointment");
    assert.equal(frontend.getTasks().length, 1);
    assert.equal(frontend.getTasks()[0].title, "Book appointment");
    assert.equal(frontend.run("state.aiMessages[state.aiMessages.length - 1].taskConfirmation.status"), "consumed");

    frontend.run("saveState(); saveAIConversation(7, state.aiMessages);");
    assert.equal(JSON.parse(frontend.storage.get("cm_tasks_v2"))[0].title, "Book appointment");
    assert.equal(frontend.run("loadAIConversation(7).at(-1).taskConfirmation.status"), "consumed");
  });

  it("does not add for an ambiguous reply, even if the AI emits an add marker", () => {
    const frontend = createFrontend();
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment to your My List?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "I guess maybe." }
    ]);

    const result = frontend.evaluateReply("[ADD_TASK: Book appointment]");

    assert.match(result.text, /Would you like me to add.*Book appointment.*My List\?/);
    assert.deepEqual(result.taskConfirmation, { status: "pending", title: "Book appointment" });
    assert.deepEqual(frontend.getTasks(), []);
  });

  it("keeps confirmation pending for an ambiguous phrase", () => {
    const frontend = createFrontend();
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment to My List?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "Maybe that might help." }
    ]);

    assert.equal(
      frontend.run("isClearAffirmative(state.aiMessages.at(-1).text, 'Book appointment')"),
      false,
    );
    const result = frontend.evaluateReply("[ADD_TASK: Book appointment]");

    assert.match(result.text, /Would you like me to add.*Book appointment.*My List\?/);
    assert.deepEqual(result.taskConfirmation, { status: "pending", title: "Book appointment" });
    assert.deepEqual(frontend.getTasks(), []);
  });

  it("recognizes natural affirmative replies, including an explicit matching task title", () => {
    const frontend = createFrontend();
    const affirmativeReplies = [
      "Yes, let's add that.",
      "Yes, add it to my list.",
      "Sure, go ahead.",
      "Absolutely.",
      "That sounds good.",
      "Let's do it.",
      "Please add that.",
      "Yes, please.",
      "Yes, let's add call dentist to my list.",
      "Please add Call dentist.",
      "I think that would help.",
      "Okay, let's do it.",
      "Yeah, add it please.",
      "Sounds good to me.",
    ];

    for (const reply of affirmativeReplies) {
      frontend.context.testReply = reply;
      assert.equal(
        frontend.run("isClearAffirmative(testReply, 'Call dentist')"),
        true,
        `Expected affirmative reply: ${reply}`,
      );
    }

    for (const reply of [
      "maybe", "not sure", "I don't know", "perhaps later",
      "that might help", "I think maybe", "we'll see",
    ]) {
      frontend.context.testReply = reply;
      assert.equal(
        frontend.run("isClearAffirmative(testReply, 'Call dentist')"),
        false,
        `Expected ambiguous reply: ${reply}`,
      );
    }

    frontend.context.testReply = "Yes, add mow lawn to my list.";
    assert.equal(frontend.run("isClearAffirmative(testReply, 'Call dentist')"), false);
  });

  it("accepts the two reported natural replies for the pending task", () => {
    for (const reply of ["Yes i think i want to add it", "yeah i think so"]) {
      const frontend = createFrontend();
      setMessages(frontend, [
        {
          role: "assistant",
          text: "Would you like me to add Find dentist's number to My List?",
          taskConfirmation: { status: "pending", title: "Find dentist's number" }
        },
        {
          role: "user",
          text: reply,
          taskConfirmation: { status: "confirmed", title: "Find dentist's number" }
        }
      ]);

      const result = frontend.evaluateReply("[ADD_TASK: Find dentist's number]");
      assert.equal(result.taskAction.type, "added", reply);
      assert.equal(result.taskAction.title, "Find dentist's number");
      assert.equal(frontend.getTasks().length, 1);
    }
  });

  it("adds only the task named by the immediately preceding pending confirmation", () => {
    const frontend = createFrontend();
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Call dentist to your My List?",
        taskConfirmation: { status: "pending", title: "Call dentist" }
      },
      {
        role: "user",
        text: "Yes, let's add call dentist to my list.",
        taskConfirmation: { status: "confirmed", title: "Call dentist" }
      }
    ]);

    const result = frontend.evaluateReply("[ADD_TASK: Call dentist]");
    assert.equal(result.taskAction.type, "added");
    assert.equal(result.taskAction.title, "Call dentist");
    assert.equal(frontend.getTasks().length, 1);
  });

  it("does not accept an affirmative reply when the pending confirmation is not the previous message", () => {
    const frontend = createFrontend();
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Call dentist?",
        taskConfirmation: { status: "pending", title: "Call dentist" }
      },
      { role: "user", text: "I have another question." },
      { role: "assistant", text: "Of course, what would you like to know?" },
      { role: "user", text: "Sure, go ahead." }
    ]);

    const result = frontend.evaluateReply("[ADD_TASK: Call dentist]");
    assert.equal(result.taskAction, null);
    assert.deepEqual(frontend.getTasks(), []);
    assert.match(result.text, /Would you like me to add.*Call dentist.*My List\?/);
  });

  it("records declines and suppresses repeated confirmation requests in that conversation", () => {
    const frontend = createFrontend();
    assert.equal(frontend.run("isClearAffirmative('Yes, please.')"), true);
    assert.equal(frontend.run("isClearDecline('No, thanks.')"), true);
    assert.equal(frontend.run("isClearDecline(\"Please don't add it.\")"), true);
    assert.equal(frontend.run("isClearAffirmative('I guess maybe.')"), false);
    assert.equal(frontend.run("isClearDecline('I guess maybe.')"), false);
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment to your My List?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "No, thanks.", taskConfirmation: { status: "declined", title: "Book appointment" } }
    ]);

    const repeatQuestion = frontend.evaluateReply("[CONFIRM_TASK: Book appointment]");
    const repeatAdd = frontend.evaluateReply("[ADD_TASK: Book appointment]");

    assert.doesNotMatch(repeatQuestion.text, /\?/);
    assert.doesNotMatch(repeatAdd.text, /\?/);
    assert.equal(repeatQuestion.taskConfirmation, null);
    assert.deepEqual(frontend.getTasks(), []);
    assert.deepEqual(
      JSON.parse(JSON.stringify(frontend.run("getDeclinedTaskTitles(state.aiMessages)"))),
      ["Book appointment"]
    );
  });

  it("blocks repeated add markers and existing duplicate task titles", () => {
    const frontend = createFrontend();
    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment to your My List?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "Yes, please.", taskConfirmation: { status: "confirmed", title: "Book appointment" } }
    ]);

    const first = frontend.evaluateReply("[ADD_TASK: Book appointment]");
    const repeated = frontend.evaluateReply("[ADD_TASK: Book appointment]");
    assert.equal(first.taskAction.type, "added");
    assert.equal(repeated.taskAction, null);
    assert.equal(frontend.getTasks().length, 1);

    setMessages(frontend, [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "Yes, please.", taskConfirmation: { status: "confirmed", title: "Book appointment" } }
    ]);
    const duplicate = frontend.evaluateReply("[ADD_TASK: book   appointment]");
    assert.equal(duplicate.taskAction, null);
    assert.equal(frontend.getTasks().length, 1);
  });

  it("preserves task completion without creating a task", () => {
    const frontend = createFrontend();
    frontend.run(`state.tasks = [{
      id: 1, title: "Book appointment", category: "", kind: "regular", due: "", done: false
    }];`);
    setMessages(frontend, [
      { role: "user", text: "I booked the appointment." }
    ]);

    const result = frontend.evaluateReply("[COMPLETE_TASK: Book appointment]");

    assert.equal(result.taskAction.type, "completed");
    assert.equal(frontend.getTasks().length, 1);
    assert.equal(frontend.getTasks()[0].done, true);
  });

  it("restores pending confirmations and declined tasks when continuing a saved chat", () => {
    const frontend = createFrontend();
    const conversation = [
      {
        role: "assistant",
        text: "Would you like me to add Book appointment?",
        taskConfirmation: { status: "pending", title: "Book appointment" }
      },
      { role: "user", text: "No thanks.", taskConfirmation: { status: "declined", title: "Book appointment" } }
    ];
    frontend.context.testMessages = JSON.stringify(conversation);
    frontend.run("saveAIConversation(7, JSON.parse(testMessages));");

    const restored = JSON.parse(JSON.stringify(frontend.run("loadAIConversation(7)")));
    frontend.context.testMessages = JSON.stringify(restored);
    frontend.run("state.aiMessages = JSON.parse(testMessages);");

    assert.equal(restored[0].taskConfirmation.status, "pending");
    assert.deepEqual(
      JSON.parse(JSON.stringify(frontend.run("getDeclinedTaskTitles(state.aiMessages)"))),
      ["Book appointment"]
    );
  });
});
