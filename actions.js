import { combineRgb, splitRgb } from '@companion-module/base'

function parseColor(color) {
	const raw = splitRgb(color)

	return {
		red: raw.r,
		green: raw.g,
		blue: raw.b,
	}
}

export function UpdateActions(self) {
	const devicePicker = {
		id: 'deviceIds',
		type: 'multidropdown',
		label: 'Devices',
		default: [],
		choices: [],
	}

	for (const [deviceId, device] of Object.entries(self.devices)) {
		devicePicker.choices.push({
			id: deviceId,
			label: device.name,
		})
	}
	console.log(devicePicker.choices, self.devices)

	self.setActionDefinitions({
		updateLeds: {
			name: 'Set All LEDs',
			options: [
				devicePicker,
				{
					id: 'color',
					type: 'colorpicker',
					label: 'Color',
					default: combineRgb(255, 255, 255),
				},
			],
			callback: async (event) => {
				const color = parseColor(event.options.color)

				const updates = []
				for (const id of event.options.deviceIds) {
					const device = self.devices[id]
					if (device) {
						const colors = []
						for (let i = 0; i < device.leds.length; i++) {
							colors.push(color)
						}
						updates.push(self.client.updateLeds(device.deviceIndex, colors))
					}
				}

				await Promise.allSettled(updates)
			},
		},
		setSingleLed: {
			name: 'Set Single LED',
			options: [
				devicePicker,
				{
					id: 'ledIndex',
					type: 'number',
					label: 'LED Index',
					min: 0,
					default: 0,
				},
				{
					id: 'color',
					type: 'colorpicker',
					label: 'Color',
					default: combineRgb(255, 255, 255),
				},
			],
			callback: async (event) => {
				const color = parseColor(event.options.color)

				const updates = []
				for (const id of event.options.deviceIds) {
					const device = self.devices[id]
					if (device) {
						updates.push(self.client.updateSingleLed(device.deviceIndex, event.options.ledIndex, color))
					}
				}

				await Promise.allSettled(updates)
			},
		},
		setSingleLedByName: {
			name: 'Set Single LED',
			options: [
				devicePicker,
				{
					id: 'ledName',
					type: 'textinput',
					label: 'LED Name',
					default: '',
				},
				{
					id: 'color',
					type: 'colorpicker',
					label: 'Color',
					default: combineRgb(255, 255, 255),
				},
			],
			callback: async (event) => {
				const color = parseColor(event.options.color)

				const updates = []
				for (const id of event.options.deviceIds) {
					const device = self.devices[id]
					if (device) {
						const ledIndex = device.leds.findIndex((l) => l.name == event.options.ledName)
						if (ledIndex !== -1) {
							updates.push(self.client.updateSingleLed(device.deviceIndex, ledIndex, color))
						}
					}
				}

				await Promise.allSettled(updates)
			},
		},
	})
}
