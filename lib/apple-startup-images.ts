type AppleStartupDevice = {
	name: string;
	deviceWidth: number;
	deviceHeight: number;
	pixelRatio: number;
};

export type AppleStartupImageSpec = {
	id: string;
	width: number;
	height: number;
	media: string;
};

const IOS_DEVICES: AppleStartupDevice[] = [
	{ name: "iphone-se", deviceWidth: 320, deviceHeight: 568, pixelRatio: 2 },
	{ name: "iphone-8", deviceWidth: 375, deviceHeight: 667, pixelRatio: 2 },
	{ name: "iphone-8-plus", deviceWidth: 414, deviceHeight: 736, pixelRatio: 3 },
	{ name: "iphone-x", deviceWidth: 375, deviceHeight: 812, pixelRatio: 3 },
	{ name: "iphone-xr", deviceWidth: 414, deviceHeight: 896, pixelRatio: 2 },
	{ name: "iphone-xs-max", deviceWidth: 414, deviceHeight: 896, pixelRatio: 3 },
	{
		name: "iphone-12-mini",
		deviceWidth: 360,
		deviceHeight: 780,
		pixelRatio: 3,
	},
	{ name: "iphone-12", deviceWidth: 390, deviceHeight: 844, pixelRatio: 3 },
	{
		name: "iphone-12-pro-max",
		deviceWidth: 428,
		deviceHeight: 926,
		pixelRatio: 3,
	},
	{
		name: "iphone-14-pro",
		deviceWidth: 393,
		deviceHeight: 852,
		pixelRatio: 3,
	},
	{
		name: "iphone-14-pro-max",
		deviceWidth: 430,
		deviceHeight: 932,
		pixelRatio: 3,
	},
	{
		name: "iphone-16-pro",
		deviceWidth: 402,
		deviceHeight: 874,
		pixelRatio: 3,
	},
	{
		name: "iphone-16-pro-max",
		deviceWidth: 440,
		deviceHeight: 956,
		pixelRatio: 3,
	},
	{ name: "ipad", deviceWidth: 768, deviceHeight: 1024, pixelRatio: 2 },
	{ name: "ipad-10-2", deviceWidth: 810, deviceHeight: 1080, pixelRatio: 2 },
	{
		name: "ipad-air-10-9",
		deviceWidth: 820,
		deviceHeight: 1180,
		pixelRatio: 2,
	},
	{
		name: "ipad-pro-10-5",
		deviceWidth: 834,
		deviceHeight: 1112,
		pixelRatio: 2,
	},
	{
		name: "ipad-pro-11",
		deviceWidth: 834,
		deviceHeight: 1194,
		pixelRatio: 2,
	},
	{
		name: "ipad-mini-8-3",
		deviceWidth: 744,
		deviceHeight: 1133,
		pixelRatio: 2,
	},
	{
		name: "ipad-pro-12-9",
		deviceWidth: 1024,
		deviceHeight: 1366,
		pixelRatio: 2,
	},
];

function mediaQuery(
	device: AppleStartupDevice,
	orientation: "portrait" | "landscape",
) {
	return [
		`(device-width: ${device.deviceWidth}px)`,
		`(device-height: ${device.deviceHeight}px)`,
		`(-webkit-device-pixel-ratio: ${device.pixelRatio})`,
		`(orientation: ${orientation})`,
	].join(" and ");
}

export const APPLE_STARTUP_IMAGE_SPECS: AppleStartupImageSpec[] =
	IOS_DEVICES.flatMap((device) => [
		{
			id: `${device.name}-portrait.png`,
			width: device.deviceWidth * device.pixelRatio,
			height: device.deviceHeight * device.pixelRatio,
			media: mediaQuery(device, "portrait"),
		},
		{
			id: `${device.name}-landscape.png`,
			width: device.deviceHeight * device.pixelRatio,
			height: device.deviceWidth * device.pixelRatio,
			media: mediaQuery(device, "landscape"),
		},
	]);

export const APPLE_STARTUP_IMAGE_BY_ID = new Map(
	APPLE_STARTUP_IMAGE_SPECS.map((spec) => [spec.id, spec]),
);
