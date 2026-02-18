import fs from "fs"
import path from "path"
import yaml from "js-yaml"

export interface Intent {
	id: string
	name: string
	status: "PENDING" | "IN_PROGRESS" | "COMPLETED"
	owned_scope: string[]
	constraints: string[]
	acceptance_criteria: string[]
}

export class IntentRegistry {
	private intents: Map<string, Intent> = new Map()
	private filePath: string

	constructor(orchestrationDir: string = ".orchestration") {
		this.filePath = path.join(process.cwd(), orchestrationDir, "active_intents.yaml")
		this.loadIntents()
	}

	private loadIntents() {
		if (!fs.existsSync(this.filePath)) {
			throw new Error(`active_intents.yaml not found at ${this.filePath}`)
		}
		const fileContents = fs.readFileSync(this.filePath, "utf8")
		const data = yaml.load(fileContents) as { active_intents: Intent[] }
		if (!data || !Array.isArray(data.active_intents)) {
			throw new Error("Invalid active_intents.yaml format")
		}
		data.active_intents.forEach((intent) => {
			if (!intent.id || !intent.name || !intent.owned_scope) {
				throw new Error(`Intent missing required fields: ${JSON.stringify(intent)}`)
			}
			this.intents.set(intent.id, intent)
		})
	}

	public getIntentById(id: string): Intent | null {
		return this.intents.get(id) || null
	}

	public getAllIntents(): Intent[] {
		return Array.from(this.intents.values())
	}

	public checkScope(intentId: string, filePath: string): boolean {
		const intent = this.getIntentById(intentId)
		if (!intent) return false
		return intent.owned_scope.some((scopePattern) => {
			const regex = new RegExp(scopePattern.replace(/\*\*/g, ".*"))
			return regex.test(filePath)
		})
	}

	public getConstraints(intentId: string): string[] {
		const intent = this.getIntentById(intentId)
		if (!intent) throw new Error(`Intent ${intentId} not found`)
		return intent.constraints
	}
}
