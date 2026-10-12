import { describe, expect, it } from "vitest"
import { parseElicitationSchema, summarizeAnswer, type QuestionField } from "./elicitation"

function single(title: string, options: { value: string; title: string }[] = [], rest: Partial<QuestionField> = {}): QuestionField {
  return { key: "q", type: "single", title, description: undefined, options, custom: false, ...rest }
}

function multi(title: string, options: { value: string; title: string }[] = [], rest: Partial<QuestionField> = {}): QuestionField {
  return { key: "q", type: "multi", title, description: undefined, options, custom: false, ...rest }
}

describe("parseElicitationSchema", () => {
  it("parses a single-choice question", () => {
    const fields = parseElicitationSchema({
      type: "object",
      properties: {
        question_0: { type: "string", title: "Favourite", description: "Pick one", oneOf: [{ const: "a", title: "A" }, { const: "b", title: "B" }] },
      },
    })
    expect(fields).toEqual([{ key: "question_0", type: "single", title: "Favourite", description: "Pick one", options: [{ value: "a", title: "A" }, { value: "b", title: "B" }], custom: false }])
  })

  it("parses multi-select", () => {
    const fields = parseElicitationSchema({
      type: "object",
      properties: {
        question_0: { type: "array", title: "Pick many", items: { type: "string", enum: ["x", "y"] }, minItems: 1, maxItems: 3 },
      },
    })
    expect(fields).toEqual([{ key: "question_0", type: "multi", title: "Pick many", description: undefined, options: [{ value: "x", title: "x" }, { value: "y", title: "y" }], min: 1, max: 3, custom: false }])
  })

  it("parses boolean, number, integer, text", () => {
    expect(parseElicitationSchema({ type: "object", properties: { a: { type: "boolean", title: "Ok" } } })).toEqual([{ key: "a", type: "boolean", title: "Ok", description: undefined, options: [], custom: false }])
    expect(parseElicitationSchema({ type: "object", properties: { a: { type: "number", minimum: 0, maximum: 10 } } })).toEqual([{ key: "a", type: "number", title: undefined, description: undefined, options: [], min: 0, max: 10, custom: false }])
    expect(parseElicitationSchema({ type: "object", properties: { a: { type: "integer" } } })).toEqual([{ key: "a", type: "integer", title: undefined, description: undefined, options: [], custom: false }])
    expect(parseElicitationSchema({ type: "object", properties: { a: { type: "string", minLength: 1, maxLength: 100 } } })).toEqual([{ key: "a", type: "text", title: undefined, description: undefined, options: [], min: 1, max: 100, custom: false }])
  })

  it("links custom-answer fields", () => {
    const fields = parseElicitationSchema({
      type: "object",
      properties: {
        question_0: { type: "string", oneOf: [{ const: "other", title: "Other" }] },
        question_0_custom: { type: "string", _meta: { _askUserQuestionCustomAnswer: { questionId: "question_0", isCustomAnswer: true } } },
      },
    })
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ key: "question_0", custom: false, customKey: "question_0_custom" })
  })

  it("drops custom-answer fields", () => {
    const fields = parseElicitationSchema({
      type: "object",
      properties: {
        question_0_custom: { type: "string", _meta: { _askUserQuestionCustomAnswer: { questionId: "question_0", isCustomAnswer: true } } },
      },
    })
    expect(fields).toHaveLength(0)
  })
})

describe("summarizeAnswer", () => {
  it("summarizes each type", () => {
    expect(summarizeAnswer(single("", [{ value: "a", title: "A" }], { customKey: "q_custom" }), { q: "a", q_custom: "note" })).toBe("note")
    expect(summarizeAnswer(multi("", [{ value: "a", title: "A" }, { value: "b", title: "B" }]), { q: ["a", "b"] })).toBe("a, b")
    expect(summarizeAnswer({ key: "q", type: "boolean", options: [] }, { q: true })).toBe("Yes")
    expect(summarizeAnswer({ key: "q", type: "boolean", options: [] }, { q: false })).toBe("No")
    expect(summarizeAnswer({ key: "q", type: "text", options: [] }, { q: "hi" })).toBe("hi")
    expect(summarizeAnswer({ key: "q", type: "number", options: [] }, { q: 42 })).toBe("42")
    expect(summarizeAnswer({ key: "q", type: "integer", options: [] }, { q: 7 })).toBe("7")
  })

  it("returns null when unanswered", () => {
    expect(summarizeAnswer({ key: "q", type: "text", options: [] }, {})).toBeNull()
  })
})
