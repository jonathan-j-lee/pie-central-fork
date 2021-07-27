import * as React from 'react';
import { Colors, Callout, Intent, Spinner, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { EditorTheme } from '../store/settings';
import {
  Alliance,
  Mode,
  ConnectionStatus,
  updateRate,
} from '../store/robot';

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
  return <Tag className="status-tag" icon={modeIcon} large minimal>{modeName}</Tag>;
}

function AllianceTag({ alliance }) {
  const editorTheme = useAppSelector((state) => state.settings.editor.editorTheme);
  let allianceName, allianceColor;
  switch (alliance) {
    case Alliance.BLUE:
      allianceName = 'Blue';
      allianceColor = editorTheme === EditorTheme.DARK ? Colors.BLUE2 : Colors.BLUE5;
      break;
    case Alliance.GOLD:
      allianceName = 'Gold';
      allianceColor = editorTheme === EditorTheme.DARK ? Colors.GOLD2 : Colors.GOLD5;
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

export default function RuntimeStatusCard() {
  const dispatch = useAppDispatch();
  React.useEffect(() => {
    const interval = setInterval(() => dispatch(updateRate()), 200);
    return () => clearInterval(interval);
  }, [dispatch]);
  const robot = useAppSelector((state) => state.robot);
  const connected = robot.status !== ConnectionStatus.DISCONNECTED;
  let status, intent;
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
    <Callout id="robot-status" title={status} intent={intent}>
      <div className="status-container">
        <div className="status-description">
          {connected ?
            <p>Update rate: {Math.round(10*robot.updateRate)/10} updates/second</p> :
            <>
              <p>Dawn is not receiving updates from Runtime.</p>
              <ul>
                <li>Are you connected to the correct WiFi network?</li>
                <li>Try restarting Runtime (see the "Debug" menu).</li>
              </ul>
            </>
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
