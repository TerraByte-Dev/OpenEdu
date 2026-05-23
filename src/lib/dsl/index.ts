// Public surface of the DSL layer.
export { toProviderJsonSchema } from "./jsonSchema";
export { SubtopicSchema, SyllabusSchema } from "./syllabus";
export type { SubtopicDSL, SyllabusDSL } from "./syllabus";
export { OutlineLevelSchema, CourseOutlineSchema } from "./course";
export type { OutlineLevelDSL, CourseOutlineDSL } from "./course";
export { verifyDslRoundTrip } from "./_roundTripCheck";
