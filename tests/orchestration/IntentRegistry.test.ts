import { IntentRegistry } from "../../src/orchestration/IntentRegistry"

const registry = new IntentRegistry()

test("Load all intents", () => {
	const intents = registry.getAllIntents()
	expect(intents.length).toBe(3)
})

test("Get intent by ID", () => {
	const intent = registry.getIntentById("INT-001")
	expect(intent).not.toBeNull()
	expect(intent?.name).toBe("Build Weather API")
})

test("Check scope validation", () => {
	const isValid = registry.checkScope("INT-001", "src/api/weather/weatherController.ts")
	expect(isValid).toBe(true)

	const isInvalid = registry.checkScope("INT-001", "src/auth/middleware.ts")
	expect(isInvalid).toBe(false)
})

test("Get constraints", () => {
	const constraints = registry.getConstraints("INT-002")
	expect(constraints).toContain("Maintain backward compatibility")
})
