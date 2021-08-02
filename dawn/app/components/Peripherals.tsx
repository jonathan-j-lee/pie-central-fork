import * as React from 'react';
import {
  Button,
  Callout,
  Card,
  Collapse,
  Colors,
  H4,
  Icon,
  Intent,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import Chart from 'chart.js/auto';
import { Scatter, defaults } from 'react-chartjs-2';
import * as _ from 'lodash';
import { useAppDispatch, useAppSelector } from '../hooks';
import { Peripheral, peripheralSelectors, updateDevices } from '../store/peripherals';
import { ConnectionStatus } from '../store/runtime';
import { EditorTheme } from '../store/settings';
import { DeviceName } from './Util';

defaults.font.family = 'monospace';

// TODO: pull catalog and parameters from Runtime
const CATALOG = {
  0: { name: 'Limit Switch', icon: IconNames.SWITCH },
  1: { name: 'Line Follower', icon: IconNames.FLASH },
  2: { name: 'Potentiometer', icon: IconNames.DOUGHNUT_CHART },
  3: { name: 'Encoder', icon: IconNames.TIME },
  4: { name: 'Battery', icon: IconNames.OFFLINE },
  5: { name: 'Team Flag', icon: IconNames.FLAG },
  7: { name: 'Servo Motor', icon: IconNames.COG },
  10: { name: 'YogiBear (Motor)', icon: IconNames.COG },
  11: { name: 'RFID', icon: IconNames.FEED },
  12: { name: 'PolarBear (Motor)', icon: IconNames.COG },
  13: { name: 'KoalaBear (Motor)', icon: IconNames.COG },
};

const makeMask = (bits) => (BigInt(1) << BigInt(bits)) - BigInt(1);
const DEVICE_MASK = makeMask(16);
const getDeviceId = (uid) => Number((BigInt(uid) >> BigInt(72)) & DEVICE_MASK);

function* makePeripheralList(peripherals) {
  for (const peripheral of peripheralSelectors.selectAll(peripherals)) {
    if (peripheral.type === 'smart-device') {
      yield {
        icon: IconNames.HELP,
        name: 'Unknown device',
        uid: peripheral.uid,
        params: peripheral.params,
        ...CATALOG[getDeviceId(peripheral.uid)],
      };
    }
  }
}

interface StyledPlotProps {
  innerRef: React.RefObject<HTMLElement>;
  param: string;
  color: string;
}

const StyledPlot = ({ innerRef, param, color, ...props }: StyledPlotProps) => {
  const tickColors = { color, backdropColor: color, textStrokeColor: color };
  return (
    <Scatter
      className="sep"
      {...props}
      ref={innerRef}
      data={{
        datasets: [
          {
            label: param,
            data: [],
            color,
            backgroundColor: color,
            borderColor: color,
            showLine: true,
          },
        ],
      }}
      options={{
        backgroundColor: color,
        scales: {
          x: {
            min: -5,
            max: 0,
            ticks: {
              stepSize: 1,
              callback: (value) => `${value}s`,
              ...tickColors,
            },
          },
          y: { ticks: tickColors },
        },
        animation: { duration: 0 },
        plugins: { legend: { labels: { color } } },
      }}
    />
  );
};

const Plot = React.memo(StyledPlot);

interface ParameterPlotProps {
  param: string;
  data: any;
  editorTheme: EditorTheme;
}

function ParameterPlot({ param, data, editorTheme }: ParameterPlotProps) {
  const color = editorTheme === EditorTheme.DARK ? Colors.GRAY4 : Colors.GRAY2;
  const ref = React.useRef();
  const chart: Chart | null = ref.current;
  if (chart) {
    const [dataset] = chart.data.datasets;
    if (dataset) {
      dataset.data = data;
      chart.update();
    }
  }
  return <Plot innerRef={ref} param={param} color={color} />;
}

interface ParameterListProps {
  editorTheme: EditorTheme;
  params: Peripheral['params'];
}

function ParameterList({ params, editorTheme }: ParameterListProps) {
  const now = Date.now();
  return (
    <>
      {_.keys(params)
        .sort()
        .map((param, index) => {
          const values = params[param];
          const [, latestValue] = values[values.length - 1];
          if (isNaN(latestValue)) {
            return (
              <pre key={index}>
                {param}: {latestValue.toString()}
              </pre>
            );
          }
          const data = values.map(([timestamp, value]) => ({
            x: (timestamp - now) / 1000,
            y: Number(value),
          }));
          return (
            <ParameterPlot
              key={index}
              param={param}
              data={data}
              editorTheme={editorTheme}
            />
          );
        })}
    </>
  );
}

const Placeholder = () => (
  <Callout intent={Intent.WARNING} className="sep">
    <H4>No Devices Detected</H4>
    <ul>
      <li>Check your connection to the robot.</li>
      <li>Ensure all cables are plugged in snugly.</li>
      <li>Press any button to connect a Gamepad.</li>
    </ul>
  </Callout>
);

export default function Peripherals() {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector((state) => state.settings.editor.editorTheme);
  const peripherals = useAppSelector((state) => state.peripherals);
  const status = useAppSelector((state) => state.runtime.status);
  const peripheralList = Array.from(makePeripheralList(peripherals));
  const [showParams, setShowParams] = React.useState({});
  React.useEffect(() => {
    const deviceCount = peripheralSelectors
      .selectAll(peripherals)
      .filter((peripheral) => peripheral.type === 'smart-device').length;
    if (deviceCount > 0 && status === ConnectionStatus.DISCONNECTED) {
      dispatch(updateDevices({}, { disconnect: true }));
      setShowParams({});
    }
  }, [dispatch, setShowParams, peripherals, status]);
  return (
    <div className="peripheral-list">
      {peripheralList.length === 0 && <Placeholder />}
      {peripheralList.map((peripheral, index) => (
        <Card key={index} className="sep">
          <p className="dev-type">
            <Icon icon={peripheral.icon} className="dev-icon" />
            {peripheral.name}
          </p>
          <Button
            className="dev-show-param"
            small
            outlined
            text="Show Parameters"
            onClick={() =>
              setShowParams({
                ...showParams,
                [peripheral.uid]: !showParams[peripheral.uid],
              })
            }
          />
          <div className="dev-id">
            <DeviceName className="dev-name" />
            <code className="dev-uid">{peripheral.uid}</code>
          </div>
          <Collapse isOpen={showParams[peripheral.uid]} className="sep">
            <ParameterList params={peripheral.params} editorTheme={editorTheme} />
          </Collapse>
        </Card>
      ))}
    </div>
  );
}
