import { Client } from 'openrgb-sdk'
import { isEqual } from 'lodash-es'
import { InstanceBase, Regex, runEntrypoint, InstanceStatus } from '@companion-module/base'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdateVariableDefinitions } from './variables.js'

class OpenRGBInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		this.devices = {}
	}

	async init(config) {
		await this.configUpdated(config)

		this.devices = {}
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
			this.updateActions() // export actions
			this.updateFeedbacks() // export feedbacks
			this.updateVariableDefinitions() // export variable definitions

			this.client = new Client('Companion', this.config.port, this.config.host)
			this.updateStatus(InstanceStatus.Connecting)

			this.client.on('connect', () => this.startStopPolling(true))
			this.client.on('disconnect', () => this.startStopPolling(true))
			this.client.on('deviceListUpdated', () =>
				this.doPollDevices().catch((e) => {
					this.log('error', `Poll failed: ${e?.message ?? e}`)
				})
			)

			this.client
				.connect()
				.then(async () => {
					this.updateStatus(InstanceStatus.Ok)
					this.startStopPolling(true)

					this.doPollDevices()
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
				this.doPollDevices().catch((e) => {
					this.log('error', `Poll failed: ${e?.message ?? e}`)
				})
			}, this.config.poll_interval)
		}
	}

	async doPollDevices() {
		// TODO - ensure not run concurrently

		// TODO - listen to deviceListUpdated instead of timed polling?

		const newDevices = {}

		const rawDevices = await Promise.all(await this.client.getAllControllerData())
		for (const device of rawDevices) {
			// Generate an id that should be stable, unlike the `deviceId` used by the api which is an index
			const syntheticId = `${device.name || device.vendor}:${device.serial || device.location}`

			newDevices[syntheticId] = {
				deviceIndex: device.deviceId,
				name: device.name,
				leds: (device.leds || []).map((l) => l.name),
			}
			// console.log('dev', device)
		}

		if (!isEqual(this.devices, newDevices)) {
			this.devices = newDevices
			console.log('devices', newDevices, JSON.stringify(rawDevices, undefined, 4))

			// TODO - performance...
			this.updateActions()
			this.updateFeedbacks()

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
