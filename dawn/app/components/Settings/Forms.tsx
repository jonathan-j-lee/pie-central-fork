import * as React from 'react';
import * as _ from 'lodash';
import {
  Button,
  Callout,
  Classes,
  EditableText as BlueprintEditableText,
  FormGroup,
  IconName,
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

interface InputOuterProps<S> {
  path: string;
  validate?: (newValue: S) => S;
}

interface InputInnerProps<S> {
  value: S;
  update: (newValue: S) => void;
}

function makeSettingInput<S, P extends InputOuterProps<S>>(
  Input: React.FC<P & InputInnerProps<S>>
): React.FC<P> {
  return (props: P) => {
    const [error, setError] = React.useState<Error | null>(null);
    const dispatch = useAppDispatch();
    const setting: S = useAppSelector((state) => _.get(state.settings, props.path));
    const validate = props.validate ?? ((newValue: S) => newValue);
    return (
      <>
        <Input
          {...props}
          value={setting}
          update={(newValue) => {
            try {
              const value = validate(newValue);
              dispatch(settingsSlice.actions.update({ path: props.path, value }));
              setError(null);
            } catch (err) {
              setError(err);
            }
          }}
        />
        {error && (
          <Callout intent={Intent.WARNING} className="sep-small">
            {error?.message ?? 'Invalid input.'}
          </Callout>
        )}
      </>
    );
  };
}

export const validateNonempty = (value: string) => {
  if (!value) {
    throw new Error('Field cannot be empty.');
  }
  return value;
};

const clamp = (value: number, min: number | undefined, max: number | undefined) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

interface BaseTextProps extends InputOuterProps<string> {
  className?: string;
  placeholder?: string;
  monospace?: boolean;
  spellCheck?: boolean;
  maxLength?: number;
}

const addTextProps = (props: BaseTextProps) => ({
  className: `${props.className ?? ''} ${props.monospace ? 'monospace' : ''}`,
  placeholder: props.placeholder,
  maxLength: props.maxLength ?? 32,
  spellCheck: props.spellCheck ?? false,
});

interface EditableTextProps extends BaseTextProps {}

export const EditableText = makeSettingInput<string, EditableTextProps>((props) => (
  <>
    <BlueprintEditableText
      alwaysRenderInput
      defaultValue={props.value}
      onConfirm={(value) => props.update(value)}
      {...addTextProps(props)}
    />
  </>
));

interface TextInputProps extends BaseTextProps {
  id?: string;
  type?: string;
  leftIcon?: IconName;
  rightElement?: JSX.Element;
}

export const TextInput = makeSettingInput<string, TextInputProps>((props) => (
  <BlueprintInputGroup
    id={props.id}
    type={props.type}
    leftIcon={props.leftIcon}
    rightElement={props.rightElement}
    defaultValue={props.value}
    onBlur={(event) => props.update(event.currentTarget.value)}
    {...addTextProps(props)}
  />
));

interface TextAreaProps extends BaseTextProps {
  id?: string;
  fill?: boolean;
  growVertically?: boolean;
  small?: boolean;
}

export const TextArea = makeSettingInput<string, TextAreaProps>((props) => (
  <BlueprintTextArea
    id={props.id}
    fill={props.fill ?? true}
    growVertically={props.growVertically ?? true}
    small={props.small ?? true}
    defaultValue={props.value}
    onBlur={(event) => props.update(event.currentTarget.value)}
    {...addTextProps(props)}
  />
));

export const PasswordInput = (props: TextInputProps) => {
  const [showPassword, setShowPassword] = React.useState(false);
  return (
    <TextInput
      {...props}
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
    />
  );
};

interface BaseNumberProps extends InputOuterProps<number> {
  className?: string;
  min?: number;
  max?: number;
  stepSize?: number;
}

interface NumericInputProps extends BaseNumberProps {
  id?: string;
  placeholder?: string;
  leftIcon?: IconName;
  minorStepSize?: number | null;
  majorStepSize?: number | null;
  clampValueOnBlur?: boolean;
}

export const NumericInput = makeSettingInput<number, NumericInputProps>((props) => (
  <BlueprintNumericInput
    id={props.id}
    className={props.className}
    placeholder={props.placeholder}
    leftIcon={props.leftIcon}
    min={props.min}
    max={props.max}
    minorStepSize={props.minorStepSize ?? null}
    stepSize={props.stepSize}
    majorStepSize={props.majorStepSize ?? null}
    clampValueOnBlur={props.clampValueOnBlur ?? true}
    defaultValue={props.value}
    onBlur={(event) =>
      props.update(clamp(Number(event.currentTarget.value), props.min, props.max))
    }
    onButtonClick={(value) => props.update(value)}
  />
));

interface SliderProps extends BaseNumberProps {
  labelStepSize?: number;
}

export const Slider = makeSettingInput<number, SliderProps>((props) => {
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

interface BaseSelectProps extends InputOuterProps<string> {
  className?: string;
  options: Array<{
    id: string;
    display: React.ReactNode;
  }>;
}

interface RadioProps extends BaseSelectProps {
  inline?: boolean;
}

export const Radio = makeSettingInput<string, RadioProps>((props) => (
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

interface SelectProps extends BaseSelectProps {
  id?: string;
}

export const Select = makeSettingInput<string, SelectProps>((props) => (
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

interface SwitchProps extends InputOuterProps<boolean> {
  id?: string;
  className?: string;
  label?: string;
  tooltip?: React.ReactNode;
}

export const Switch = makeSettingInput<boolean, SwitchProps>((props) => (
  <BlueprintSwitch
    id={props.id}
    className={props.className}
    checked={props.value}
    onChange={() => props.update(!props.value)}
    aria-label={props.label}
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

type Entity = { [id: string]: any };
type EntityUpdater = (kv: [string, any]) => void;
interface EntityTableProps extends InputOuterProps<Entity> {
  id?: string;
  className?: string;
  striped?: boolean;
  headings: Array<string>;
  default?: [string, any];
  widths?: Array<number>;
  render: (kv: [string, any], update: EntityUpdater) => Array<React.ReactNode>;
  emptyMessage?: string;
  addLabel?: string;
}

export const EntityTable = makeSettingInput<Entity, EntityTableProps>((props) => {
  const [rows, setRows] = React.useState(_.toPairs(props.value));
  const update = (newRows: Array<[string, any]>) => {
    setRows(newRows);
    props.update(_.fromPairs(newRows));
  };
  const widths =
    props.widths ?? Array(props.headings.length).fill(100 / props.headings.length);
  return (
    <>
      <BlueprintTable
        id={props.id}
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
            rows.map((row, rowIndex: number) => (
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
                  .map((cell, cellIndex: number) => (
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
        onClick={() => setRows([...rows, props.default ?? ['', null]])}
      />
    </>
  );
});
