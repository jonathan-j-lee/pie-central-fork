import * as React from 'react';
import { Colors, Callout, Intent, Spinner, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { EditorTheme } from '../store/settings';
import { Alliance, Mode, ConnectionStatus, updateRate } from '../store/runtime';

function ModeTag(props: { mode: Mode }) {
  let modeName, modeIcon;
  switch (props.mode) {
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
  return (
    <Tag className="status-tag" icon={modeIcon} large minimal>
      {modeName}
    </Tag>
  );
}

function AllianceTag(props: { alliance: Alliance }) {
  const editorTheme = useAppSelector((state) => state.settings.editor.editorTheme);
  let allianceName, allianceColor;
  switch (props.alliance) {
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

// TODO: replace divs and spans with fragments
export default function RuntimeStatusCard() {
  const dispatch = useAppDispatch();
  React.useEffect(() => {
    const interval = setInterval(() => dispatch(updateRate()), 200);
    return () => clearInterval(interval);
  }, [dispatch]);
  const runtime = useAppSelector((state) => state.runtime);
  const connected = runtime.status !== ConnectionStatus.DISCONNECTED;
  let status, intent;
  if (!connected) {
    status = 'Disconnected';
  } else if (runtime.error) {
    status = 'Errors Detected';
    intent = Intent.DANGER;
  } else if (runtime.status === ConnectionStatus.UNHEALTHY) {
    status = 'Increased Latency';
    intent = Intent.WARNING;
  } else {
    status = 'Connected';
    intent = Intent.SUCCESS;
  }
  return (
    <Callout id="runtime-status" title={status} intent={intent}>
      <div className="status-container">
        <div className="status-description">
          {connected ? (
            <p>
              Update rate: {Math.round(10 * runtime.updateRate) / 10} updates/second
            </p>
          ) : (
            <>
              <p>Dawn is not receiving updates from Runtime.</p>
              <ul>
                <li>Are you connected to the correct WiFi network?</li>
                <li>Try restarting Runtime (see the &#34;Debug&#34; menu).</li>
              </ul>
            </>
          )}
        </div>
        <Spinner
          size={40}
          value={connected ? runtime.relUpdateRate : null}
          intent={intent}
        />
      </div>
      {connected && (
        <>
          <ModeTag mode={runtime.mode} />
          <AllianceTag alliance={runtime.alliance} />
        </>
      )}
    </Callout>
  );
}
