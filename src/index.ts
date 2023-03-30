import timestring from 'timestring';
import { IPluginWithOptions } from '@simple-cli/base';
import { ILabeledTimeSeriesData, ITSAPluginArgs, TSAPluginResult } from '@tsa-tools/cli';
import { exec } from 'shelljs';

enum MetricType {
	cpu = 'cpu',
	ram = 'ram',
}

const definitions = [
	{
		name: 'resource-group',
		type: String,
		description: 'Passed through to `az resource list`',
	},
	{
		name: 'metric',
		type: String,
		description: 'One of [cpu|ram]',
	},
	{
		name: 'filter',
		type: String,
		description: 'RegEx to match resource names',
	},
];

interface IAZOptions {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	'resource-group': string;
}

interface IAdditionalOptions {
	metric: MetricType;
	filter: string;
}

type IAZPluginOptions = IAZOptions & IAdditionalOptions;

interface IAZResource {
	id: string;
	name: string;
}

interface IMetricDataPoint {
	average: number;
	timeStamp: string;
}

const metricNames = {
	cpu: 'Percentage CPU',
	ram: 'Available Memory Bytes',
};

function getValidInterval(stepMS: number) {
	const validIntervals = ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d'].map((display) => ({
		display,
		ms: timestring(display, 'ms', {}),
	}));
	const closestMatch = validIntervals.reduce(
		(best, v) => (Math.abs(v.ms - stepMS) < Math.abs(best.ms - stepMS) ? v : best),
		validIntervals[0]
	);
	return closestMatch.display;
}

function execOrFail(command: string) {
	const { code, stdout, stderr } = exec(command.trim(), { silent: true });
	if (code !== 0) {
		console.error(`❌ Command failed: '${command}' ❌`);
		console.log(stdout);
		console.error(stderr);
		process.exit(1);
	}

	return stdout;
}

async function execOrFailAsync(command: string): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command.trim(), { silent: true }, (code, stdout, stderr) => {
			if (code !== 0) {
				console.error(`❌ Command failed: '${command}' ❌`);
				console.log(stdout);
				console.error(stderr);
				process.exit(1);
			}

			resolve(stdout);
		});
	});
}

function az<T>(command: string) {
	return JSON.parse(execOrFail(`az ${command}`)) as T;
}

async function azAsync<T>(command: string) {
	return JSON.parse(await execOrFailAsync(`az ${command}`)) as T;
}

function getVMIds(options: IAZPluginOptions) {
	const group = options['resource-group'] ? `--resource-group ${options['resource-group']}` : '';
	const type = '--resource-type Microsoft.Compute/virtualMachines';
	return az<IAZResource[]>(`resource list ${type} ${group}`)
		.filter((x) => {
			if (!options.filter) {
				return true;
			}
			const pattern = new RegExp(options.filter);
			return pattern.test(x.name);
		})
		.map(({ id, name }) => ({ id, name }));
}

async function getTimeSeries(id: string, options: string) {
	const resource = `--resource ${id}`;
	const data = (await azAsync(`monitor metrics list ${resource} ${options}`)) as any;
	const { timeseries } = data.value[0] || {};
	const ts = timeseries.length > 0 ? timeseries[0].data : null;
	return ts as IMetricDataPoint[];
}

function transformValue(v: number, metric: MetricType) {
	if (metric === MetricType.ram) {
		// Available bytes, transform to GB
		return v / 1_000_000_000;
	}

	return v;
}

function logMetricTypeDescription(metric: MetricType) {
	switch (metric) {
		case MetricType.cpu:
			console.log('  CPU metrics are "Percent CPU" used.');
			console.log("  A high maximum means there isn't a lot of headroom during peak load.");
			console.log(
				'  A low mean means the vm might be over provisioned and is costing more money than it needs to be.'
			);
			break;
		case MetricType.ram:
			console.log('  RAM metrics are "Available GB".');
			console.log("  A low minimum means there isn't a lot of headroom during peak load.");
			console.log(
				'  A high mean means the vm might be over provisioned and is costing more money than it needs to be.'
			);
			break;
		default:
			break;
	}
}

const execute = async ({ start, end, step }: ITSAPluginArgs, options: IAZPluginOptions) => {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const intervalValue = getValidInterval(step);
	const startTime = `--start-time ${startDate.toISOString()}`;
	const endTime = `--end-time ${endDate.toISOString()}`;
	const interval = `--interval ${intervalValue}`;
	const metricType = options.metric ?? MetricType.cpu;
	const metrics = `--metric "${metricNames[metricType]}"`;
	const timeSeriesFlags = `${metrics} ${startTime} ${endTime} ${interval}`;

	console.log(
		`Querying ${metricType} stats from ${startDate.toDateString()} @ ${startDate.toLocaleTimeString()} to ${endDate.toDateString()} @ ${endDate.toLocaleTimeString()} using an interval of ${intervalValue}`
	);
	logMetricTypeDescription(metricType);

	try {
		const vmIds = getVMIds(options);
		const totalQueries = vmIds.length;
		let completedQueries = 0;

		const data: ILabeledTimeSeriesData = {};

		const logProgress = () => {
			process.stdout.clearLine(0);
			process.stdout.cursorTo(0);
			process.stdout.write(
				`Fetching data… (${completedQueries} / ${totalQueries} queries completed)`
			);
		};

		logProgress();

		const dataPromises = vmIds.map((vm) =>
			(async () => {
				const rawSeries = await getTimeSeries(vm.id, timeSeriesFlags);
				if (rawSeries) {
					const label = vm.name;
					const series = rawSeries
						.filter((x) => x.average !== null)
						.map((x) => [new Date(x.timeStamp), transformValue(x.average, metricType)]);
					data[label] = series as any;
				}

				completedQueries += 1;

				logProgress();
			})()
		);

		await Promise.all(dataPromises);

		process.stdout.clearLine(0);
		process.stdout.cursorTo(0);

		return { data };
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
};

const plugin: IPluginWithOptions<IAZPluginOptions, ITSAPluginArgs, TSAPluginResult> = {
	definitions,
	execute,
};

export default plugin;
