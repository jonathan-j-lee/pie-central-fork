import * as React from 'react';
import * as _ from 'lodash';
import {
  Button,
  Callout,
  Classes,
  EditableText as BlueprintEditableText,
  FormGroup,
  Intent,
  HTMLSelect as BlueprintSelect,
  HTMLTable as BlueprintTable,
  InputGroup as BlueprintInputGroup,
  NumericInput as BlueprintNumericInput,
  Radio as BlueprintRadio,
  RadioGroup as BlueprintRadioGroup,
  Slider as BlueprintSlider,
  Switch as BlueprintSwitch,
  TextArea as BlueprintTextArea,
  Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../../hooks';
import settingsSlice from '../../store/settings';

function makeSettingInput(Input) {
  return (props) => {
    const dispatch = useAppDispatch();
    const setting = useAppSelector((state) => _.get(state.settings, props.path));
    const [error, setError] = React.useState(null);
    const validate = props.validate ?? ((value) => Promise.resolve(value));
    return (
      <>
        <Input
          {...props}
          value={setting}
          update={async (rawValue) => {
            try {
              const value = await validate(rawValue);
              dispatch(settingsSlice.actions.update({ path: props.path, value }));
              setError(null);
            } catch (err) {
              setError(err);
            }
          }}
        />
        {error && (
          <Callout intent={Intent.WARNING} className="sep-small">
            {error.message}
          </Callout>
        )}
      </>
    );
  };
}

export const validateNonempty = async (value) => {
  if (!value) {
    throw new Error('Field cannot be empty.');
  }
  return value;
};

const clamp = (value, min, max) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

export const EditableText = makeSettingInput((props) => (
  <BlueprintEditableText
    alwaysRenderInput
    className={`${props.className} ${props.monospace ? 'monospace' : ''}`}
    defaultValue={props.value}
    onConfirm={(value) => props.update(value)}
    placeholder={props.placeholder}
    maxLength={props.maxLength ?? 32}
  />
));

export const TextInput = makeSettingInput((props) => (
  <BlueprintInputGroup
    id={props.id}
    className={`${props.className} ${props.monospace ? 'monospace' : ''}`}
    type={props.type}
    defaultValue={props.value}
    onBlur={(event) => props.update(event.currentTarget.value)}
    placeholder={props.placeholder}
    leftIcon={props.leftIcon}
    rightElement={props.rightElement}
    spellCheck={props.spellCheck ?? false}
    maxLength={props.maxLength ?? 32}
  />
));

export const TextArea = makeSettingInput((props) => (
  <BlueprintTextArea
    id={props.id}
    className={`${props.className} ${props.monospace ? 'monospace' : ''}`}
    defaultValue={props.value}
    onBlur={(event) => props.update(event.currentTarget.value)}
    fill={props.fill ?? true}
    growVertically={props.growVertically ?? true}
    small={props.small}
    placeholder={props.placeholder}
    spellCheck={props.spellCheck ?? false}
  />
));

export const PasswordInput = (props) => {
  const [showPassword, setShowPassword] = React.useState(false);
  return (
    <TextInput
      type={showPassword ? 'text' : 'password'}
      rightElement={
        <Tooltip content={<span>{showPassword ? 'Hide' : 'Show'} password</span>}>
          <Button
            minimal
            icon={showPassword ? IconNames.UNLOCK : IconNames.LOCK}
            intent={Intent.WARNING}
            onClick={() => setShowPassword(!showPassword)}
          />
        </Tooltip>
      }
      leftIcon={IconNames.KEY}
      {...props}
    />
  );
};

export const NumericInput = makeSettingInput((props) => (
  <BlueprintNumericInput
    id={props.id}
    className={props.className}
    defaultValue={props.value}
    onButtonClick={(value) => props.update(value)}
    onBlur={(event) =>
      props.update(clamp(Number(event.currentTarget.value), props.min, props.max))
    }
    placeholder={props.placeholder}
    leftIcon={props.leftIcon}
    min={props.min}
    max={props.max}
    minorStepSize={props.minorStepSize ?? null}
    stepSize={props.stepSize}
    majorStepSize={props.majorStepSize ?? null}
    clampValueOnBlur={props.clampValueOnBlur ?? true}
  />
));

export const Radio = makeSettingInput((props) => (
  <BlueprintRadioGroup
    className={props.className}
    inline={props.inline ?? true}
    selectedValue={props.value}
    onChange={(event) => props.update(event.currentTarget.value)}
  >
    {props.options.map(({ id, display }, index) => (
      <BlueprintRadio key={index} value={id}>
        {display}
      </BlueprintRadio>
    ))}
  </BlueprintRadioGroup>
));

export const Select = makeSettingInput((props) => (
  <BlueprintSelect
    id={props.id}
    className={props.className}
    value={props.value}
    onChange={(event) => props.update(event.currentTarget.value)}
  >
    {props.options.map(({ id, display }, index) => (
      <option value={id} key={index}>
        {display}
      </option>
    ))}
  </BlueprintSelect>
));

export const Slider = makeSettingInput((props) => {
  const [value, setValue] = React.useState(props.value);
  return (
    <BlueprintSlider
      className={`slider ${props.className}`}
      value={value}
      onChange={(value) => setValue(value)}
      onRelease={(value) => props.update(value)}
      min={props.min}
      max={props.max}
      stepSize={props.stepSize}
      labelStepSize={props.labelStepSize}
    />
  );
});

export const Switch = makeSettingInput((props) => (
  <BlueprintSwitch
    id={props.id}
    className={props.className}
    checked={props.value}
    onChange={() => props.update(!props.value)}
    {...(props.tooltip
      ? {
          labelElement: (
            <Tooltip
              className={Classes.TOOLTIP_INDICATOR}
              content={<p className="tooltip-content">{props.tooltip}</p>}
            >
              {props.label}
            </Tooltip>
          ),
        }
      : { label: props.label })}
  />
));

export const EntityTable = makeSettingInput((props) => {
  const [rows, setRows] = React.useState(_.toPairs(props.value));
  const update = (newRows) => {
    setRows(newRows);
    props.update(_.fromPairs(newRows));
  };
  const widths =
    props.widths ?? Array(props.headings.length).fill(100 / props.headings.length);
  return (
    <>
      <BlueprintTable
        striped={props.striped ?? true}
        className={`entity-table ${props.className ?? ''}`}
      >
        <colgroup>
          <col />
          {widths.map((width, index) => (
            <col key={index} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td></td>
            {props.headings.map((heading, index) => (
              <td key={index}>{heading}</td>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td>
                  <Button
                    minimal
                    intent={Intent.DANGER}
                    icon={IconNames.DELETE}
                    onClick={() =>
                      update([...rows.slice(0, rowIndex), ...rows.slice(rowIndex + 1)])
                    }
                  />
                </td>
                {props
                  .render(row, (newRow) => update(_.set(rows, rowIndex, newRow)))
                  .map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={1 + props.headings.length} className="empty-row">
                {props.emptyMessage ?? 'No items'}
              </td>
            </tr>
          )}
        </tbody>
      </BlueprintTable>
      <Button
        className="sep"
        intent={Intent.SUCCESS}
        icon={IconNames.ADD}
        text={props.addLabel ?? 'Add item'}
        onClick={() => setRows([...rows, props.default ?? [null, null]])}
      />
    </>
  );
});
