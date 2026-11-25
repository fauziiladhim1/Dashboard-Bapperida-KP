import { Chip, DateField, DateRangePicker, Label, RangeCalendar, Table, type DateRange } from '@heroui/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pagination } from '@/components/common/Pagination';
import { Panel } from '@/components/common/Panel';
import { endpoints } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { auditText } from '@/lib/i18n';
import { useT } from '@/lib/prefs';

export default function AuditPage() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<DateRange | null>(null);
  const from = range?.start.toString();
  const to = range?.end.toString();
  const { data } = useQuery({ queryKey: ['audit', page, from, to], queryFn: () => endpoints.audit(page, from, to), placeholderData: keepPreviousData });
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  return (
    <Panel title={t('log.title')} subtitle={t('log.sub')}>
      <DateRangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} className="w-full sm:w-80">
        <Label>{t('log.range')}</Label>
        <DateField.Group>
          <DateField.InputContainer>
            <DateField.Input slot="start">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
            <DateRangePicker.RangeSeparator />
            <DateField.Input slot="end">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
          </DateField.InputContainer>
          <DateField.Suffix>
            <DateRangePicker.Trigger><DateRangePicker.TriggerIndicator /></DateRangePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <DateRangePicker.Popover>
          <RangeCalendar aria-label={t('log.range')}>
            <RangeCalendar.Header>
              <RangeCalendar.YearPickerTrigger>
                <RangeCalendar.YearPickerTriggerHeading />
                <RangeCalendar.YearPickerTriggerIndicator />
              </RangeCalendar.YearPickerTrigger>
              <RangeCalendar.NavButton slot="previous" />
              <RangeCalendar.NavButton slot="next" />
            </RangeCalendar.Header>
            <RangeCalendar.Grid>
              <RangeCalendar.GridHeader>{(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
              <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
            </RangeCalendar.Grid>
          </RangeCalendar>
        </DateRangePicker.Popover>
      </DateRangePicker>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={t('log.title')} className="min-w-[560px]">
            <Table.Header>
              <Table.Column isRowHeader>{t('log.time')}</Table.Column>
              <Table.Column>{t('log.user')}</Table.Column>
              <Table.Column>{t('log.activity')}</Table.Column>
              <Table.Column>IP</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-12 text-center text-sm text-muted">{t('common.noData')}</p>}>
              {(data?.data ?? []).map((a) => (
                <Table.Row key={a.id} id={a.id}>
                  <Table.Cell className="text-xs whitespace-nowrap text-muted">{fmtDateTime(a.createdAt)}</Table.Cell>
                  <Table.Cell className="font-medium">{a.userName ?? t('common.system')}</Table.Cell>
                  <Table.Cell><Chip size="sm" variant="soft" className="mr-2">{a.action}</Chip>{auditText(t, a)}</Table.Cell>
                  <Table.Cell className="font-mono text-xs text-muted">{a.ip}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <Pagination page={page} pages={pages} onChange={setPage} className="justify-end" />
    </Panel>
  );
}
