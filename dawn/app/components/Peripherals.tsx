import * as React from 'react';
import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Collapse,
  Colors,
  EditableText,
  Elevation,
  H4,
  Icon,
  Intent,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import Chart from 'chart.js/auto';
import { Scatter, defaults } from 'react-chartjs-2';
import * as _ from 'lodash';
import { useAppDispatch, useAppSelector } from '../hooks';
import { EditorTheme } from '../store/editor';
import { updateDevices } from '../store/peripherals';
import { Alliance, Mode, ConnectionStatus } from '../store/robot';
import { updateRate } from '../store/robot';
import { updateGamepads } from '../store/peripherals';

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

const makeMask = bits => (BigInt(1) << BigInt(bits)) - BigInt(1);
const DEVICE_MASK = makeMask(16);
const getDeviceId = uid => Number((BigInt(uid) >> BigInt(72)) & DEVICE_MASK);

function *makePeripheralList({ devices }) {
  for (const uid of _.keys(devices).sort()) {
    yield {
      icon: IconNames.HELP,
      name: 'Unknown device',
      uid,
      params: devices[uid],
      ...CATALOG[getDeviceId(uid)],
    };
  }
}

const StyledPlot = ({ innerRef, param, color, ...props }) => {
  const tickColors = { color, backdropColor: color, textStrokeColor: color };
  return (
    <Scatter
      {...props}
      ref={innerRef}
      data={{
        datasets: [{
          label: param,
          data: [],
          color,
          backgroundColor: color,
          borderColor: color,
          showLine: true,
        }],
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
}

const Plot = React.memo(StyledPlot);

function ParameterPlot({ param, data, editorTheme }) {
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
  return <Plot className="sep" innerRef={ref} param={param} color={color} />;
}

function ParameterList({ params, editorTheme }) {
  const now = Date.now();
  return (
    <>
      {_.keys(params)
        .sort()
        .map((param, index) => {
          const values = params[param];
          const [_timestamp, latestValue] = values[values.length - 1];
          if (isNaN(latestValue)) {
            return <pre key={index}>{param}: {latestValue.toString()}</pre>;
          }
          const data = values.map(([timestamp, value]) =>
            ({ x: (timestamp - now)/1000, y: Number(value) }));
          return (
            <ParameterPlot
              key={index}
              param={param}
              data={data}
              editorTheme={editorTheme}
            />
          );
        })
      }
    </>
  );
}

function ModeTag({ mode }) {
  let modeName, modeIcon;
  switch (mode) {
    case Mode.AUTO:
      modeName = 'Autonomous';
      modeIcon = IconNames.DESKTOP;
      break;
    case Mode.TELEOP:
      modeName = 'Teleop';
      modeIcon = IconNames.SATELLITE;
      break;
    default:
      modeName = 'Idle';
      modeIcon = IconNames.OFFLINE;
  }
  return (<Tag className="status-tag" icon={modeIcon} large minimal>{modeName}</Tag>);
}

function AllianceTag({ alliance }) {
  const theme = useAppSelector(state => state.editor.editorTheme);
  let allianceName, allianceColor;
  switch (alliance) {
    case Alliance.BLUE:
      allianceName = 'Blue';
      allianceColor = theme === EditorTheme.DARK ? Colors.BLUE2 : Colors.BLUE5;
      break;
    case Alliance.GOLD:
      allianceName = 'Gold';
      allianceColor = theme === EditorTheme.DARK ? Colors.GOLD2 : Colors.GOLD5;
      break;
    default:
      allianceName = 'No Alliance';
      allianceColor = null;
  }
  return (
    <Tag
      className="status-tag"
      icon={IconNames.FLAG}
      large
      minimal
      style={{ backgroundColor: allianceColor }}
    >
      {allianceName}
    </Tag>
  );
}

function Status() {
  const dispatch = useAppDispatch();
  const robot = useAppSelector(state => state.robot);
  let status, intent;
  const connected = robot.status !== ConnectionStatus.DISCONNECTED;
  React.useEffect(() => {
    const interval = setInterval(() => dispatch(updateRate()), 200);
    return () => clearInterval(interval);
  }, [dispatch]);
  if (!connected) {
    status = 'Disconnected';
  } else if (robot.error) {
    status = 'Errors Detected';
    intent = Intent.DANGER;
  } else if (robot.status === ConnectionStatus.UNHEALTHY) {
    status = 'Increased Latency';
    intent = Intent.WARNING;
  } else {
    status = 'Connected';
    intent = Intent.SUCCESS;
  }
  return (
    <Callout title={status} intent={intent}>
      <div className="status-container">
        <div className="status-description">
          {connected ?
            <p>Update rate: {Math.round(10*robot.updateRate)/10} updates/second</p> :
            <div>
              <p>Dawn is not receiving updates from Runtime.</p>
              <ul>
                <li>Are you connected to the correct WiFi network?</li>
                <li>Try restarting Runtime (see the "Debug" menu).</li>
              </ul>
            </div>
          }
        </div>
        <Spinner
          size={40}
          value={connected ? robot.relUpdateRate : null}
          intent={intent}
        />
      </div>
      {connected && <div>
        <ModeTag mode={robot.mode} />
        <AllianceTag alliance={robot.alliance} />
      </div>}
    </Callout>
  );
}

export default function Peripherals() {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const peripherals = useAppSelector(state => state.peripherals);
  const status = useAppSelector(state => state.robot.status);
  const peripheralList = Array.from(makePeripheralList(peripherals));
  const [showParams, setShowParams] = React.useState({});
  React.useEffect(() => {
    if (_.keys(peripherals.devices).length && status === ConnectionStatus.DISCONNECTED) {
      dispatch(updateDevices({}, { disconnect: true }));
      setShowParams({});
    }
  });
  return (
    <div className="peripherals">
      <div className="peripheral-list">
        <Status />
        {peripheralList.length === 0 &&
          <Callout intent={Intent.WARNING} className="sep">
            <H4>No Devices Detected</H4>
            <ul>
              <li>Check your connection to the robot.</li>
              <li>Ensure all cables are plugged in snugly.</li>
              <li>Press any button to connect a Gamepad.</li>
            </ul>
          </Callout>
        }
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
              onClick={() => setShowParams({
                ...showParams,
                [peripheral.uid]: !showParams[peripheral.uid],
              })}
            />
            <div className="dev-id">
              <EditableText alwaysRenderInput placeholder="Assign a name" maxLength={32} className="dev-name" />
              <code className="dev-uid">{peripheral.uid}</code>
            </div>
            <Collapse isOpen={showParams[peripheral.uid]} className="sep">
              <ParameterList params={peripheral.params} editorTheme={editorTheme} />
            </Collapse>
          </Card>
        ))}
      </div>
    </div>
  );
};
