import { Client } from 'openrgb-sdk'
import { isEqual } from 'lodash-es'
import { InstanceBase, Regex, runEntrypoint, InstanceStatus } from '@companion-module/base'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdateVariableDefinitions } from './variables.js'
import PQueue from 'p-queue'
import pTimeout, { TimeoutError } from 'p-timeout'

const POLL_TIMEOUT = 30000 // Generous timeout for the poll, so it doesn't get stuck

class OpenRGBInstance extends InstanceBase {
	#pollQueue = new PQueue({
		concurrency: 1,
	})

	constructor(internal) {
		super(internal)

		this.devices = {}
		this.devicesState = {}
	}

	async init(config) {
		await this.configUpdated(config)

		this.devices = {}
		this.devicesState = {}
		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
	}
	// When module gets deleted
	async destroy() {
		this.log('debug', 'destroy')

		if (this.client) {
			await this.client.disconnect().catch((e) => {
				// Ignore
			})
			delete this.client
		}
	}

	async configUpdated(config) {
		const oldConfig = this.config || {}
		this.config = config

		if (this.client) {
			this.startStopPolling(false)
			this.updateStatus(InstanceStatus.Disconnected)

			this.client.disconnect().catch((e) => {
				// Ignore
			})
			delete this.client
		}

		if (this.config.port !== oldConfig.port || this.config.host !== oldConfig.host) {
			// Reset any tracked state
			this.devices = {}
			this.devicesState = {}
			this.updateActions() // export actions
			this.updateFeedbacks() // export feedbacks
			this.updateVariableDefinitions() // export variable definitions
			this.checkFeedbacks()

			this.client = new Client('Companion', this.config.port, this.config.host)
			this.updateStatus(InstanceStatus.Connecting)

			this.client.on('connect', () => this.startStopPolling(true))
			this.client.on('disconnect', () => this.startStopPolling(true))
			this.client.on('deviceListUpdated', () => this.#triggerPollDevices())

			this.client
				.connect()
				.then(async () => {
					this.updateStatus(InstanceStatus.Ok)
					this.startStopPolling(true)

					this.#triggerPollDevices()
				})
				.catch((e) => {
					this.updateStatus(InstanceStatus.UnknownError, `Connection failed: ${e?.message ?? e}`)
				})
		}

		if (this.config.poll_interval !== oldConfig.poll_interval && this.pollTimer) {
			this.startStopPolling(false)
			this.startStopPolling(true)
		}
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 8,
				regex: Regex.IP,
				default: '127.0.0.1',
			},
			{
				type: 'number',
				id: 'port',
				label: 'Target Port',
				width: 4,
				min: 1,
				max: 65535,
				default: 6742,
			},
			{
				type: 'number',
				id: 'poll_interval',
				label: 'Poll Interval',
				width: 4,
				min: 0,
				max: 600000,
				default: 30000,
			},
		]
	}

	startStopPolling(run) {
		if (this.pollTimer && !run) {
			clearInterval(this.pollTimer)
			delete this.pollTimer
		}

		if (run && !this.pollTimer && this.config.poll_interval) {
			this.pollTimer = setInterval(() => {
				this.#triggerPollDevices()
			}, this.config.poll_interval)
		}
	}

	#triggerPollDevices() {
		this.#pollQueue
			.add(async () => {
				const abortController = new AbortController()
				await pTimeout(this.#doPollDevices(abortController.signal), {
					milliseconds: POLL_TIMEOUT,
					fallback: () => {
						abortController.abort()
						throw new TimeoutError('Timed out')
					},
				})
			})
			.catch((e) => {
				this.log('error', `Poll failed: ${e?.message ?? e}`)
			})
	}

	async #doPollDevices(signal) {
		const newDevices = {}
		const newState = {}

		const rawDevices = await Promise.all(await this.client.getAllControllerData())
		if (signal.aborted) return

		for (const device of rawDevices) {
			// Generate an id that should be stable, unlike the `deviceId` used by the api which is an index
			const syntheticId = `${device.name || device.vendor}:${device.serial || device.location}`.trim()

			newDevices[syntheticId] = {
				deviceIndex: device.deviceId,
				name: device.name,
				leds: (device.leds || []).map((l) => l.name),
			}
			newState[syntheticId] = {
				colors: device.colors || [],
			}
		}

		if (signal.aborted) return

		if (!isEqual(this.devices, newDevices)) {
			this.devices = newDevices

			this.updateActions()
			this.updateFeedbacks()
		}

		if (!isEqual(this.devicesState, newState)) {
			// TODO - update variables
			this.checkFeedbacks()
		}
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(OpenRGBInstance, UpgradeScripts)
