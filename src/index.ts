#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const OPENWEBUI_API_URL = process.env.OPENWEBUI_API_URL || "";
const API_KEY = process.env.OPENWEBUI_API_KEY || ""; // Will be set by user
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4-turbo"; // Default model

class OpenWebUIServer {
	private server: Server;
	private axiosInstance;

	constructor() {
		this.server = new Server(
			{
				name: "openwebui-server",
				version: "0.1.0",
			},
			{
				capabilities: {
					resources: {},
					tools: {},
				},
			},
		);

		this.axiosInstance = axios.create({
			baseURL: OPENWEBUI_API_URL,
			headers: {
				"Content-Type": "application/json",
			},
		});

		this.setupToolHandlers();
		this.setupResourceHandlers();

		this.server.onerror = (error) => console.error("[MCP Error]", error);
		process.on("SIGINT", async () => {
			await this.server.close();
			process.exit(0);
		});
	}

	private setupToolHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				{
					name: "upload_file",
					description: "Upload file to OpenWebUI",
					inputSchema: {
						type: "object",
						properties: {
							file_path: { type: "string" },
						},
						required: ["file_path"],
					},
				},
				{
					name: "chat_with_rag",
					description: "Chat using RAG with OpenWebUI",
					inputSchema: {
						type: "object",
						properties: {
							model: { type: "string" },
							query: { type: "string" },
							file_id: { type: "string", optional: true },
							collection_id: { type: "string", optional: true },
						},
						required: ["model", "query"],
					},
				},
			],
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			if (!API_KEY) {
				throw new McpError(ErrorCode.InvalidRequest, "API key not set");
			}

			if (!request.params.arguments) {
				throw new McpError(ErrorCode.InvalidParams, "Arguments are required");
			}

			switch (request.params.name) {
				case "upload_file":
					if (typeof request.params.arguments.file_path !== "string") {
						throw new McpError(
							ErrorCode.InvalidParams,
							"file_path must be a string",
						);
					}
					return this.handleFileUpload({
						file_path: request.params.arguments.file_path,
					});
				case "chat_with_rag": {
					if (typeof request.params.arguments.query !== "string") {
						throw new McpError(
							ErrorCode.InvalidParams,
							"query must be a string",
						);
					}
					const model = request.params.arguments.model || DEFAULT_MODEL;
					if (typeof model !== "string") {
						throw new McpError(
							ErrorCode.InvalidParams,
							"model must be a string",
						);
					}
					const result = await this.handleRagChat({
						model: model,
						query: request.params.arguments.query,
						file_id:
							typeof request.params.arguments.file_id === "string"
								? request.params.arguments.file_id
								: undefined,
						collection_id:
							typeof request.params.arguments.collection_id === "string"
								? request.params.arguments.collection_id
								: undefined,
					});
					return {
						content: [
							{
								type: "text",
								text: result.response,
							},
						],
					};
				}
				default:
					throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
			}
		});
	}

	private async handleFileUpload(args: { file_path: string }): Promise<{
		success: boolean;
		file_id?: string;
	}> {
		// Implementation for file upload
		return { success: false };
	}

	private async handleRagChat(args: {
		model: string;
		query: string;
		file_id?: string;
		collection_id?: string;
	}): Promise<{ response: string }> {
		try {
			type FileRef = {
				type: "file" | "collection";
				id: string;
			};

			const payload: {
				model: string;
				messages: { role: string; content: string }[];
				files: FileRef[];
			} = {
				model: args.model,
				messages: [{ role: "user", content: args.query }],
				files: [],
			};

			if (args.file_id) {
				payload.files.push({ type: "file", id: args.file_id });
			} else if (args.collection_id) {
				payload.files.push({ type: "collection", id: args.collection_id });
			}

			const response = await this.axiosInstance.post(
				"/chat/completions",
				payload,
				{
					headers: {
						Authorization: `Bearer ${API_KEY}`,
						"Content-Type": "application/json",
					},
				},
			);

			return { response: response.data.choices[0].message.content };
		} catch (error) {
			if (axios.isAxiosError(error)) {
				throw new McpError(
					ErrorCode.InternalError,
					`RAG API error: ${error.response?.data.message ?? error.message}`,
				);
			}
			throw error;
		}
	}

	private setupResourceHandlers() {
		// Resource handlers implementation
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error("OpenWebUI MCP server running on stdio");
	}
}

const server = new OpenWebUIServer();
server.run().catch(console.error);
